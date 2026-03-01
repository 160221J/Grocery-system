import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("grocery.db");
db.exec("PRAGMA foreign_keys = ON;");

// Initialize Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit_type TEXT NOT NULL, -- 'unit', 'weight', 'volume'
    cost_price REAL DEFAULT 0,
    selling_price REAL DEFAULT 0,
    quantity REAL DEFAULT 0,
    min_stock REAL DEFAULT 5
  );

  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total_amount REAL NOT NULL,
    total_profit REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER,
    product_id INTEGER,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    cost_price REAL NOT NULL,
    profit REAL NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL, -- 'cash', 'item'
    product_id INTEGER,
    amount REAL NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS stock_arrivals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    quantity REAL NOT NULL,
    cost_price REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`);

// Seed initial data if empty
const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get() as { count: number };
if (productCount.count === 0) {
  const insert = db.prepare("INSERT INTO products (name, unit_type, cost_price, selling_price, quantity, min_stock) VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("Dahl (Red)", "weight", 180, 220, 50, 10);
  insert.run("Sugar", "weight", 150, 180, 100, 20);
  insert.run("Coconut Oil", "volume", 450, 550, 20, 5);
  insert.run("Milk Powder 400g", "unit", 950, 1050, 15, 5);
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.get("/api/dashboard", (req, res) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const salesToday = db.prepare("SELECT COUNT(*) as count, SUM(total_amount) as total_sales, SUM(total_profit) as total_profit FROM sales WHERE date(created_at) = date(?)").get(today) as any;
      const withdrawalsToday = db.prepare("SELECT SUM(amount) as total FROM withdrawals WHERE date(created_at) = date(?)").get(today) as any;
      const lowStock = db.prepare("SELECT COUNT(*) as count FROM products WHERE quantity <= min_stock").get();
      
      res.json({ 
        salesCount: salesToday.count || 0,
        totalSales: salesToday.total_sales || 0,
        totalProfit: (salesToday.total_profit || 0) - (withdrawalsToday.total || 0),
        lowStockCount: lowStock.count
      });
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/products", (req, res) => {
    try {
      const products = db.prepare("SELECT * FROM products ORDER BY name ASC").all();
      res.json(products);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/products", (req, res) => {
    try {
      const { name, unit_type, cost_price, selling_price, quantity, min_stock } = req.body;
      const info = db.prepare("INSERT INTO products (name, unit_type, cost_price, selling_price, quantity, min_stock) VALUES (?, ?, ?, ?, ?, ?)")
        .run(name, unit_type, cost_price, selling_price, quantity, min_stock);
      res.json({ id: info.lastInsertRowid });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/products/:id", (req, res) => {
    try {
      const { cost_price, selling_price, quantity, min_stock } = req.body;
      db.prepare("UPDATE products SET cost_price = ?, selling_price = ?, quantity = ?, min_stock = ? WHERE id = ?")
        .run(cost_price, selling_price, quantity, min_stock, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/sales", (req, res) => {
    try {
      const { items } = req.body;
      let totalAmount = 0;
      let totalProfit = 0;

      const transaction = db.transaction(() => {
        const saleInfo = db.prepare("INSERT INTO sales (total_amount, total_profit) VALUES (0, 0)").run();
        const saleId = saleInfo.lastInsertRowid;

        for (const item of items) {
          const product = db.prepare("SELECT * FROM products WHERE id = ?").get(item.product_id) as any;
          const profit = (item.selling_price - product.cost_price) * item.quantity;
          const amount = item.selling_price * item.quantity;

          totalAmount += amount;
          totalProfit += profit;

          db.prepare("INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, cost_price, profit) VALUES (?, ?, ?, ?, ?, ?)")
            .run(saleId, item.product_id, item.quantity, item.selling_price, product.cost_price, profit);

          db.prepare("UPDATE products SET quantity = quantity - ? WHERE id = ?").run(item.quantity, item.product_id);
        }

        db.prepare("UPDATE sales SET total_amount = ?, total_profit = ? WHERE id = ?").run(totalAmount, totalProfit, saleId);
        return saleId;
      });

      const saleId = transaction();
      res.json({ success: true, saleId });
    } catch (error) {
      console.error("Sales error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sales/daily", (req, res) => {
    try {
      const sales = db.prepare(`
        SELECT s.*, (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) as item_count 
        FROM sales s 
        ORDER BY created_at DESC
      `).all();
      res.json(sales);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/withdrawals", (req, res) => {
    try {
      const { type, product_id, amount, description } = req.body;
      // Convert 0 to null for foreign key compatibility
      const pid = (type === 'item' && product_id !== 0) ? product_id : null;
      
      const transaction = db.transaction(() => {
        db.prepare("INSERT INTO withdrawals (type, product_id, amount, description) VALUES (?, ?, ?, ?)")
          .run(type, pid, amount, description);
        
        if (type === 'item' && pid) {
          db.prepare("UPDATE products SET quantity = quantity - 1 WHERE id = ?").run(pid);
        }
      });
      transaction();
      res.json({ success: true });
    } catch (error) {
      console.error("Withdrawal error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/withdrawals", (req, res) => {
    try {
      const withdrawals = db.prepare("SELECT * FROM withdrawals ORDER BY created_at DESC").all();
      res.json(withdrawals);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/stock-arrivals", (req, res) => {
    try {
      const { product_id, quantity, cost_price } = req.body;
      const transaction = db.transaction(() => {
        db.prepare("INSERT INTO stock_arrivals (product_id, quantity, cost_price) VALUES (?, ?, ?)")
          .run(product_id, quantity, cost_price);
        
        db.prepare("UPDATE products SET quantity = quantity + ?, cost_price = ? WHERE id = ?")
          .run(quantity, cost_price, product_id);
      });
      transaction();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stock-arrivals", (req, res) => {
    try {
      const arrivals = db.prepare(`
        SELECT sa.*, p.name as product_name 
        FROM stock_arrivals sa 
        JOIN products p ON sa.product_id = p.id 
        ORDER BY sa.created_at DESC
      `).all();
      res.json(arrivals);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/sales/:id", (req, res) => {
    try {
      const saleId = req.params.id;
      console.log(`[API] Deleting sale: ${saleId}`);
      const transaction = db.transaction(() => {
        const items = db.prepare("SELECT * FROM sale_items WHERE sale_id = ?").all(saleId) as any[];
        for (const item of items) {
          db.prepare("UPDATE products SET quantity = quantity + ? WHERE id = ?").run(item.quantity, item.product_id);
        }
        db.prepare("DELETE FROM sale_items WHERE sale_id = ?").run(saleId);
        db.prepare("DELETE FROM sales WHERE id = ?").run(saleId);
      });
      transaction();
      res.json({ success: true });
    } catch (error) {
      console.error("Delete sale error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/withdrawals/:id", (req, res) => {
    try {
      const id = req.params.id;
      console.log(`[API] Deleting withdrawal: ${id}`);
      const transaction = db.transaction(() => {
        const withdrawal = db.prepare("SELECT * FROM withdrawals WHERE id = ?").get(id) as any;
        if (withdrawal && withdrawal.type === 'item' && withdrawal.product_id) {
          db.prepare("UPDATE products SET quantity = quantity + 1 WHERE id = ?").run(withdrawal.product_id);
        }
        db.prepare("DELETE FROM withdrawals WHERE id = ?").run(id);
      });
      transaction();
      res.json({ success: true });
    } catch (error) {
      console.error("Delete withdrawal error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/stock-arrivals/:id", (req, res) => {
    try {
      const id = req.params.id;
      console.log(`[API] Deleting stock arrival: ${id}`);
      const transaction = db.transaction(() => {
        const arrival = db.prepare("SELECT * FROM stock_arrivals WHERE id = ?").get(id) as any;
        if (arrival) {
          db.prepare("UPDATE products SET quantity = quantity - ? WHERE id = ?").run(arrival.quantity, arrival.product_id);
          db.prepare("DELETE FROM stock_arrivals WHERE id = ?").run(id);
        }
      });
      transaction();
      res.json({ success: true });
    } catch (error) {
      console.error("Delete stock arrival error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sales/monthly", (req, res) => {
    try {
      const monthlyStats = db.prepare(`
        SELECT 
          strftime('%Y-%m', created_at) as month,
          SUM(total_amount) as total_sales,
          SUM(total_profit) as total_profit,
          (SELECT SUM(amount) FROM withdrawals WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', s.created_at)) as total_withdrawals
        FROM sales s
        GROUP BY month
        ORDER BY month DESC
      `).all();
      res.json(monthlyStats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/reset/daily", (req, res) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const transaction = db.transaction(() => {
        // We don't revert stock for a bulk reset, just clear history
        db.prepare("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE date(created_at) = date(?))").run(today);
        db.prepare("DELETE FROM sales WHERE date(created_at) = date(?)").run(today);
        db.prepare("DELETE FROM withdrawals WHERE date(created_at) = date(?)").run(today);
      });
      transaction();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/reset/monthly", (req, res) => {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const transaction = db.transaction(() => {
        db.prepare("DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE strftime('%Y-%m', created_at) = ? )").run(currentMonth);
        db.prepare("DELETE FROM sales WHERE strftime('%Y-%m', created_at) = ?").run(currentMonth);
        db.prepare("DELETE FROM withdrawals WHERE strftime('%Y-%m', created_at) = ?").run(currentMonth);
      });
      transaction();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/query", (req, res) => {
    try {
      const { sql } = req.body;
      if (!sql) return res.status(400).json({ error: "SQL query is required" });
      
      const isSelect = sql.trim().toLowerCase().startsWith("select") || sql.trim().toLowerCase().startsWith("pragma");
      
      if (isSelect) {
        const results = db.prepare(sql).all();
        res.json({ results });
      } else {
        const info = db.prepare(sql).run();
        res.json({ results: [info] });
      }
    } catch (error) {
      console.error("SQL Query error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/products/:id", (req, res) => {
    try {
      const id = req.params.id;
      const transaction = db.transaction(() => {
        // Delete related records first to avoid foreign key violations
        db.prepare("DELETE FROM sale_items WHERE product_id = ?").run(id);
        db.prepare("DELETE FROM withdrawals WHERE product_id = ?").run(id);
        db.prepare("DELETE FROM stock_arrivals WHERE product_id = ?").run(id);
        db.prepare("DELETE FROM products WHERE id = ?").run(id);
        
        // Clean up empty sales (sales with no items left)
        db.prepare("DELETE FROM sales WHERE id NOT IN (SELECT DISTINCT sale_id FROM sale_items)").run();
      });
      transaction();
      res.json({ success: true });
    } catch (error) {
      console.error("Delete product error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    // Explicitly handle index.html for dev mode
    app.get("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = await fs.promises.readFile(path.resolve(__dirname, "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e);
        next(e);
      }
    });
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ShopFlow Server running on http://localhost:${PORT}`);
  });
}

startServer();
