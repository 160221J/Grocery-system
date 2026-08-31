import express from "express";
import { DatabaseSync } from "node:sqlite";
import { getAsset, isSea } from "node:sea";
import path from "path";
import fs from "fs";
import { exec } from "child_process";

const packaged = isSea();

function getAppDirectory() {
  // Packaged .exe: files live next to the executable.
  // Portable folder / npm start: use the folder you launched from.
  if (packaged) {
    return path.dirname(process.execPath);
  }
  return process.cwd();
}

const sqlite = new DatabaseSync(path.join(getAppDirectory(), "grocery.db"));
sqlite.exec("PRAGMA foreign_keys = ON;");

function runInTransaction<T>(fn: () => T): T {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      sqlite.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors if the transaction was already closed.
    }
    throw error;
  }
}

const db = Object.assign(sqlite, {
  transaction<T>(fn: () => T) {
    return () => runInTransaction(fn);
  },
});

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

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS daily_summaries (
    date TEXT PRIMARY KEY,
    total_sales REAL DEFAULT 0,
    total_profit REAL DEFAULT 0,
    total_withdrawals REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: Add product_name to sale_items if it doesn't exist
try {
  db.prepare("ALTER TABLE sale_items ADD COLUMN product_name TEXT").run();
} catch (e) {
  // Column probably already exists or table doesn't exist yet (though it should)
}

// Migration: Add user_name to sales table if it doesn't exist
try {
  db.prepare("ALTER TABLE sales ADD COLUMN user_name TEXT").run();
} catch (e) {
  // Column probably already exists
}

// Seed initial products if empty
const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get() as { count: number };
if (productCount.count === 0) {
  const insert = db.prepare("INSERT INTO products (name, unit_type, cost_price, selling_price, quantity, min_stock) VALUES (?, ?, ?, ?, ?, ?)");
  insert.run("Dahl (Red)", "weight", 180, 220, 50, 10);
  insert.run("Sugar", "weight", 150, 180, 100, 20);
  insert.run("Coconut Oil", "volume", 450, 550, 20, 5);
  insert.run("Milk Powder 400g", "unit", 950, 1050, 15, 5);
}

// Seed initial users if empty
const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
if (userCount.count === 0) {
  const insertUser = db.prepare("INSERT OR IGNORE INTO users (name) VALUES (?)");
  const existingSalesUsers = db.prepare("SELECT DISTINCT user_name FROM sales WHERE user_name IS NOT NULL AND TRIM(user_name) != ''").all() as { user_name: string }[];
  const initialNames = new Set<string>(['System', 'Partner A', 'Partner B']);
  existingSalesUsers.forEach(u => initialNames.add(u.user_name));
  initialNames.forEach(name => {
    try {
      insertUser.run(name);
    } catch (e) {
      // Ignore duplicates
    }
  });
}

// Automated Database Retention & Cleanup Job
// - Inventory (products) and users: Kept FOREVER
// - Summary data (daily_summaries): Kept up to 12 months (365 days)
// - Granular transactions (sales, sale_items, withdrawals, stock_arrivals): Kept for 7 days
function runDatabaseCleanup() {
  try {
    console.log("[Cleanup] Starting daily database retention cleanup...");

    const cleanupTransaction = db.transaction(() => {
      // 1. Identify dates older than 7 days with sales or withdrawals
      const oldSaleDates = db.prepare(`
        SELECT DISTINCT date(created_at) as date 
        FROM sales 
        WHERE date(created_at) < date('now', '-7 days')
      `).all() as { date: string }[];

      const oldWithdrawalDates = db.prepare(`
        SELECT DISTINCT date(created_at) as date 
        FROM withdrawals 
        WHERE date(created_at) < date('now', '-7 days')
      `).all() as { date: string }[];

      const allOldDates = Array.from(new Set([
        ...oldSaleDates.map(d => d.date),
        ...oldWithdrawalDates.map(d => d.date)
      ])).filter(Boolean);

      // 2. Save daily totals into daily_summaries BEFORE deleting raw transaction records
      const upsertSummary = db.prepare(`
        INSERT INTO daily_summaries (date, total_sales, total_profit, total_withdrawals)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          total_sales = excluded.total_sales,
          total_profit = excluded.total_profit,
          total_withdrawals = excluded.total_withdrawals
      `);

      for (const d of allOldDates) {
        const salesAgg = db.prepare(`
          SELECT COALESCE(SUM(total_amount), 0) as sales, COALESCE(SUM(total_profit), 0) as profit
          FROM sales
          WHERE date(created_at) = ?
        `).get(d) as { sales: number; profit: number };

        const withdrawalAgg = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as withdrawals
          FROM withdrawals
          WHERE date(created_at) = ?
        `).get(d) as { withdrawals: number };

        upsertSummary.run(
          d,
          salesAgg.sales || 0,
          salesAgg.profit || 0,
          withdrawalAgg.withdrawals || 0
        );
      }

      // 3. Purge granular records older than 7 days
      db.prepare(`
        DELETE FROM sale_items 
        WHERE sale_id IN (
          SELECT id FROM sales WHERE date(created_at) < date('now', '-7 days')
        )
      `).run();

      const deletedSales = db.prepare(`
        DELETE FROM sales WHERE date(created_at) < date('now', '-7 days')
      `).run();

      const deletedWithdrawals = db.prepare(`
        DELETE FROM withdrawals WHERE date(created_at) < date('now', '-7 days')
      `).run();

      const deletedArrivals = db.prepare(`
        DELETE FROM stock_arrivals WHERE date(created_at) < date('now', '-7 days')
      `).run();

      // 4. Purge daily summaries older than 12 months (365 days)
      const deletedSummaries = db.prepare(`
        DELETE FROM daily_summaries WHERE date < date('now', '-365 days')
      `).run();

      console.log(`[Cleanup] Daily summaries saved for ${allOldDates.length} days. Deleted ${deletedSales.changes} old sales, ${deletedWithdrawals.changes} old withdrawals, ${deletedArrivals.changes} old stock arrivals, ${deletedSummaries.changes} summaries > 12 months.`);
    });

    cleanupTransaction();

    // 5. Reclaim SQLite disk space
    db.exec("VACUUM;");
    console.log("[Cleanup] Database VACUUM completed successfully.");
  } catch (error) {
    console.error("[Cleanup] Database cleanup error:", error);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Run cleanup on server startup and schedule daily (once every 24 hours)
  runDatabaseCleanup();
  setInterval(() => {
    runDatabaseCleanup();
  }, 24 * 60 * 60 * 1000);

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

  app.get("/api/users", (req, res) => {
    try {
      const users = db.prepare("SELECT * FROM users ORDER BY id ASC").all();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/users", (req, res) => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "User name is required" });
      }
      const trimmed = name.trim();
      const info = db.prepare("INSERT INTO users (name) VALUES (?)").run(trimmed);
      res.json({ id: Number(info.lastInsertRowid), name: trimmed });
    } catch (error) {
      if (error.message && error.message.includes("UNIQUE")) {
        return res.status(400).json({ error: "A user with this name already exists" });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/users/sync", (req, res) => {
    try {
      const { names } = req.body;
      if (!Array.isArray(names) || names.length === 0) {
        return res.status(400).json({ error: "Names array is required" });
      }
      const syncTransaction = db.transaction(() => {
        const placeholders = names.map(() => '?').join(',');
        db.prepare(`DELETE FROM users WHERE name NOT IN (${placeholders})`).run(...names);
        
        const insertStmt = db.prepare("INSERT OR IGNORE INTO users (name) VALUES (?)");
        for (const name of names) {
          if (name && name.trim()) {
            insertStmt.run(name.trim());
          }
        }
      });
      syncTransaction();
      const updatedUsers = db.prepare("SELECT * FROM users ORDER BY id ASC").all();
      res.json(updatedUsers);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/users/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/users/name/:name", (req, res) => {
    try {
      db.prepare("DELETE FROM users WHERE name = ?").run(req.params.name);
      res.json({ success: true });
    } catch (error) {
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
      res.json({ id: Number(info.lastInsertRowid) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/products/:id", (req, res) => {
    try {
      const { name, cost_price, selling_price, quantity, min_stock } = req.body;
      db.prepare("UPDATE products SET name = ?, cost_price = ?, selling_price = ?, quantity = ?, min_stock = ? WHERE id = ?")
        .run(name, cost_price, selling_price, quantity, min_stock, req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/sales", (req, res) => {
    try {
      const { items, user_name } = req.body;
      let totalAmount = 0;
      let totalProfit = 0;

      const transaction = db.transaction(() => {
        const saleInfo = db.prepare("INSERT INTO sales (total_amount, total_profit, user_name) VALUES (0, 0, ?)")
          .run(user_name || 'System');
        const saleId = Number(saleInfo.lastInsertRowid);

        for (const item of items) {
          const product = db.prepare("SELECT * FROM products WHERE id = ?").get(item.product_id) as any;
          
          let costPrice = item.selling_price;
          let profit = 0;
          let productId = item.product_id;

          if (product) {
            costPrice = product.cost_price;
            profit = (item.selling_price - costPrice) * item.quantity;
          } else {
            // If product didn't exist in DB (custom item), treat as item with 0 profit
            // Use null for product_id in sale_items to avoid FK constraint issues if using negative IDs
            productId = null;
          }

          const amount = item.selling_price * item.quantity;

          totalAmount += amount;
          totalProfit += profit;

          db.prepare("INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, cost_price, profit) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(saleId, productId, item.name, item.quantity, item.selling_price, costPrice, profit);

          if (productId) {
            db.prepare("UPDATE products SET quantity = quantity - ? WHERE id = ?").run(item.quantity, productId);
          }
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

  app.get("/api/sales/:id/items", (req, res) => {
    try {
      const items = db.prepare(`
        SELECT si.*, COALESCE(si.product_name, p.name) as product_name 
        FROM sale_items si 
        LEFT JOIN products p ON si.product_id = p.id 
        WHERE si.sale_id = ?
      `).all(req.params.id);
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sales/daily", (req, res) => {
    try {
      const sales = db.prepare(`
        SELECT s.id, s.total_amount, s.total_profit, s.created_at, COALESCE(s.user_name, 'System') as user_name, 
               (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) as item_count 
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
          month,
          SUM(total_sales) as total_sales,
          SUM(total_profit) as total_profit,
          SUM(total_withdrawals) as total_withdrawals
        FROM (
          SELECT 
            strftime('%Y-%m', created_at) as month,
            SUM(total_amount) as total_sales,
            SUM(total_profit) as total_profit,
            (SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', s.created_at)) as total_withdrawals
          FROM sales s
          WHERE date(created_at) >= date('now', '-7 days')
          GROUP BY month

          UNION ALL

          SELECT 
            strftime('%Y-%m', date) as month,
            SUM(total_sales) as total_sales,
            SUM(total_profit) as total_profit,
            SUM(total_withdrawals) as total_withdrawals
          FROM daily_summaries
          WHERE date < date('now', '-7 days') AND date >= date('now', '-365 days')
          GROUP BY month
        ) Combined
        GROUP BY month
        ORDER BY month DESC
      `).all();
      res.json(monthlyStats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sales/daily-stats", (req, res) => {
    try {
      const dailyStats = db.prepare(`
        WITH RecentDates AS (
          SELECT DISTINCT date(created_at) as date FROM sales WHERE date(created_at) >= date('now', '-7 days')
          UNION
          SELECT DISTINCT date(created_at) as date FROM withdrawals WHERE date(created_at) >= date('now', '-7 days')
        ),
        RecentStats AS (
          SELECT 
            rd.date as date,
            COALESCE((SELECT SUM(total_amount) FROM sales WHERE date(created_at) = rd.date), 0) as total_sales,
            COALESCE((SELECT SUM(total_profit) FROM sales WHERE date(created_at) = rd.date), 0) as total_profit,
            COALESCE((SELECT SUM(amount) FROM withdrawals WHERE date(created_at) = rd.date), 0) as total_withdrawals
          FROM RecentDates rd
        )
        SELECT date, total_sales, total_profit, total_withdrawals FROM RecentStats
        UNION ALL
        SELECT date, total_sales, total_profit, total_withdrawals
        FROM daily_summaries
        WHERE date < date('now', '-7 days') AND date >= date('now', '-365 days')
        ORDER BY date DESC
      `).all();
      res.json(dailyStats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/cleanup", (req, res) => {
    try {
      runDatabaseCleanup();
      res.json({ success: true, message: "Database cleanup completed successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/cleanup-status", (req, res) => {
    try {
      const summaryCount = db.prepare("SELECT COUNT(*) as count FROM daily_summaries").get() as { count: number };
      const salesCount = db.prepare("SELECT COUNT(*) as count FROM sales").get() as { count: number };
      const withdrawalsCount = db.prepare("SELECT COUNT(*) as count FROM withdrawals").get() as { count: number };
      const oldestSale = db.prepare("SELECT MIN(created_at) as oldest FROM sales").get() as { oldest: string };
      const oldestSummary = db.prepare("SELECT MIN(date) as oldest FROM daily_summaries").get() as { oldest: string };
      
      res.json({
        summaryRecordsCount: summaryCount.count,
        activeSalesCount: salesCount.count,
        activeWithdrawalsCount: withdrawalsCount.count,
        oldestActiveSale: oldestSale.oldest || 'None',
        oldestSummaryDate: oldestSummary.oldest || 'None',
        retentionPolicy: {
          inventory: "Kept Forever",
          rawTransactions: "7 Days",
          summaryData: "12 Months (365 Days)",
          schedule: "Automated Daily"
        }
      });
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

  function contentTypeFor(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".map": "application/json",
    };
    return types[ext] || "application/octet-stream";
  }

  function openBrowser(url: string) {
    const command =
      process.platform === "win32"
        ? `cmd /c start "" "${url}"`
        : process.platform === "darwin"
          ? `open "${url}"`
          : `xdg-open "${url}"`;
    exec(command, () => {
      // Ignore missing desktop/browser on servers
    });
  }

  function isPageRequest(reqPath: string) {
    const ext = path.extname(reqPath.split("?")[0]);
    return ext === "" || ext === ".html";
  }

  if (packaged) {
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api")) return next();
      const key = req.path === "/" ? "index.html" : decodeURIComponent(req.path.replace(/^\//, ""));
      try {
        const asset = getAsset(key);
        res.status(200).set("Content-Type", contentTypeFor(key)).end(Buffer.from(asset));
      } catch {
        if (!isPageRequest(req.path)) {
          res.status(404).end();
          return;
        }
        try {
          const html = getAsset("index.html");
          res.status(200).set("Content-Type", "text/html; charset=utf-8").end(Buffer.from(html));
        } catch (error) {
          next(error);
        }
      }
    });
  } else {
    const distDir = path.join(getAppDirectory(), "dist");
    const hasBuiltUi = fs.existsSync(path.join(distDir, "index.html"));
    // npm run dev always uses Vite. A leftover dist/ folder must not hide the live UI.
    const useVite = process.env.NODE_ENV !== "production";

    if (useVite) {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);

      app.get("*", async (req, res, next) => {
        if (!isPageRequest(req.path)) return next();
        const url = req.originalUrl;
        try {
          let template = await fs.promises.readFile(path.resolve(getAppDirectory(), "index.html"), "utf-8");
          template = await vite.transformIndexHtml(url, template);
          res.status(200).set({ "Content-Type": "text/html" }).end(template);
        } catch (e) {
          vite.ssrFixStacktrace(e as Error);
          next(e);
        }
      });
    } else if (hasBuiltUi) {
      app.use(express.static(distDir));
      app.get("*", (req, res, next) => {
        if (!isPageRequest(req.path)) return next();
        res.sendFile(path.join(distDir, "index.html"));
      });
    } else {
      console.error("No built UI found. Run npm run build, or use npm run dev.");
      process.exit(1);
    }
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, "0.0.0.0", () => {
    const url = `http://localhost:${PORT}`;
    console.log(`ShopFlow is running.`);
    console.log(`Mode: ${packaged ? "executable" : process.env.NODE_ENV === "production" ? "production" : "development"}`);
    console.log(`Open this address in your browser: ${url}`);
    console.log(`Data file: ${path.join(getAppDirectory(), "grocery.db")}`);
    console.log(`Leave this window open while you use the shop.`);
    if (packaged || process.env.SHOPFLOW_OPEN_BROWSER === "1") {
      openBrowser(url);
    }
  });
}

startServer();
