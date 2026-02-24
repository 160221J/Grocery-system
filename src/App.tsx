/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  TrendingUp, 
  MinusCircle, 
  PlusCircle, 
  Search, 
  Trash2, 
  History,
  DollarSign,
  AlertTriangle,
  Edit2,
  Save,
  X,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Product {
  id: number;
  name: string;
  unit_type: 'unit' | 'weight' | 'volume';
  cost_price: number;
  selling_price: number;
  quantity: number;
  min_stock: number;
}

interface SaleItem {
  product_id: number;
  name: string;
  quantity: number;
  selling_price: number;
}

interface DashboardStats {
  salesCount: number;
  totalSales: number;
  totalProfit: number;
  lowStockCount: number;
}

// --- Components ---

const SidebarItem = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
      active 
        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' 
        : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
    }`}
  >
    <Icon size={20} />
    <span className="font-medium text-sm">{label}</span>
  </button>
);

const SearchableSelect = ({ items, onSelect, placeholder, label }: { items: any[], onSelect: (item: any) => void, placeholder: string, label: string }) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const filtered = useMemo(() => 
    items.filter(item => item.name.toLowerCase().includes(query.toLowerCase())),
    [items, query]
  );

  return (
    <div className="relative">
      <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">{label}</label>
      <div className="relative">
        <input 
          type="text"
          className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 pr-10"
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
        />
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
      </div>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-50 w-full mt-1 bg-white border border-zinc-200 rounded-xl shadow-xl max-h-60 overflow-y-auto"
          >
            {filtered.length > 0 ? (
              filtered.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full text-left px-4 py-3 hover:bg-zinc-50 text-sm border-b border-zinc-100 last:border-0"
                  onClick={() => {
                    onSelect(item);
                    setQuery(item.name);
                    setIsOpen(false);
                  }}
                >
                  <div className="font-bold text-zinc-900">{item.name}</div>
                  <div className="text-xs text-zinc-500">Stock: {item.quantity} {item.unit_type}</div>
                </button>
              ))
            ) : (
              <div className="p-4 text-center text-zinc-400 text-sm italic">No products found</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {isOpen && <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />}
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'sales' | 'inventory' | 'stock-arrival' | 'withdrawals' | 'profit'>('dashboard');
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ salesCount: 0, totalSales: 0, totalProfit: 0, lowStockCount: 0 });
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  
  // History States
  const [saleHistory, setSaleHistory] = useState<any[]>([]);
  const [withdrawalHistory, setWithdrawalHistory] = useState<any[]>([]);
  const [arrivalHistory, setArrivalHistory] = useState<any[]>([]);

  // New Product State (for Stock Arrival)
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [newProductForm, setNewProductForm] = useState({ name: '', unit_type: 'unit', cost_price: 0, selling_price: 0, quantity: 0, min_stock: 5 });

  // Editing State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Stock Arrival State
  const [arrivalForm, setArrivalForm] = useState({ product_id: 0, quantity: 0, cost_price: 0 });
  
  // Withdrawal State
  const [withdrawalForm, setWithdrawalForm] = useState({ type: 'cash', product_id: 0, amount: 0, description: '' });

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [prodRes, statsRes] = await Promise.all([
        fetch('/api/products'),
        fetch('/api/dashboard')
      ]);
      setProducts(await prodRes.json());
      setStats(await statsRes.json());
      
      if (activeTab === 'profit') {
        const historyRes = await fetch('/api/sales/daily');
        setSaleHistory(await historyRes.json());
      }
      if (activeTab === 'withdrawals') {
        const historyRes = await fetch('/api/withdrawals');
        setWithdrawalHistory(await historyRes.json());
      }
      if (activeTab === 'stock-arrival') {
        const historyRes = await fetch('/api/stock-arrivals');
        setArrivalHistory(await historyRes.json());
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUndoSale = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm('Are you sure you want to undo this sale? Stock will be returned.')) return;
    try {
      const res = await fetch(`/api/sales/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchData();
      } else {
        const err = await res.json();
        alert(`Failed to undo sale: ${err.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Undo failed:', error);
      alert('Network error while undoing sale');
    }
  };

  const handleUndoWithdrawal = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm('Are you sure you want to undo this withdrawal?')) return;
    try {
      const res = await fetch(`/api/withdrawals/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchData();
      } else {
        const err = await res.json();
        alert(`Failed to undo withdrawal: ${err.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Undo failed:', error);
      alert('Network error while undoing withdrawal');
    }
  };

  const handleUndoArrival = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm('Are you sure you want to undo this stock arrival? Stock will be deducted.')) return;
    try {
      const res = await fetch(`/api/stock-arrivals/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchData();
      } else {
        const err = await res.json();
        alert(`Failed to undo arrival: ${err.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Undo failed:', error);
      alert('Network error while undoing arrival');
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newProductForm)
      });
      if (res.ok) {
        setIsNewProduct(false);
        setNewProductForm({ name: '', unit_type: 'unit', cost_price: 0, selling_price: 0, quantity: 0, min_stock: 5 });
        fetchData();
        alert('New product added!');
      } else {
        const err = await res.json();
        alert(`Failed to add product: ${err.error}`);
      }
    } catch (error) {
      console.error('Creation failed:', error);
      alert('Network error while adding product');
    }
  };

  const addToCart = (product: Product) => {
    const existing = cart.find(item => item.product_id === product.id);
    if (existing) {
      setCart(cart.map(item => item.product_id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      setCart([...cart, { product_id: product.id, name: product.name, quantity: 1, selling_price: product.selling_price }]);
    }
  };

  const updateCartItem = (productId: number, field: keyof SaleItem, value: any) => {
    setCart(cart.map(item => item.product_id === productId ? { ...item, [field]: value } : item));
  };

  const removeFromCart = (productId: number) => {
    setCart(cart.filter(item => item.product_id !== productId));
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart })
      });
      if (res.ok) {
        setCart([]);
        fetchData();
        alert('Sale completed successfully!');
      } else {
        const err = await res.json();
        alert(`Failed to complete sale: ${err.error}`);
      }
    } catch (error) {
      console.error('Checkout failed:', error);
      alert('Network error while completing sale');
    }
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct) return;
    try {
      const res = await fetch(`/api/products/${editingProduct.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingProduct)
      });
      if (res.ok) {
        setEditingProduct(null);
        fetchData();
      }
    } catch (error) {
      console.error('Update failed:', error);
    }
  };

  const handleStockArrival = async (e: React.FormEvent) => {
    e.preventDefault();
    if (arrivalForm.product_id === 0) {
      alert('Please select a product first');
      return;
    }
    try {
      const res = await fetch('/api/stock-arrivals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(arrivalForm)
      });
      if (res.ok) {
        setArrivalForm({ product_id: 0, quantity: 0, cost_price: 0 });
        fetchData();
        alert('Stock updated!');
      } else {
        const err = await res.json();
        alert(`Failed to update stock: ${err.error}`);
      }
    } catch (error) {
      console.error('Stock arrival failed:', error);
      alert('Network error while updating stock');
    }
  };

  const handleWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (withdrawalForm.type === 'item' && withdrawalForm.product_id === 0) {
      alert('Please select an item for withdrawal');
      return;
    }
    if (withdrawalForm.amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    try {
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withdrawalForm)
      });
      if (res.ok) {
        setWithdrawalForm({ type: 'cash', product_id: 0, amount: 0, description: '' });
        await fetchData();
        alert('Withdrawal recorded!');
      } else {
        const err = await res.json();
        alert(`Failed to record withdrawal: ${err.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Withdrawal failed:', error);
      alert('Network error while recording withdrawal');
    }
  };

  const renderDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><TrendingUp size={20} /></div>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Daily Profit</span>
          </div>
          <div className="text-2xl font-bold text-zinc-900">Rs. {stats.totalProfit.toLocaleString()}</div>
          <div className="mt-1 text-xs text-zinc-500">After withdrawals</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><ShoppingCart size={20} /></div>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Sales Count</span>
          </div>
          <div className="text-2xl font-bold text-zinc-900">{stats.salesCount}</div>
          <div className="mt-1 text-xs text-zinc-500">Bills processed today</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg"><AlertTriangle size={20} /></div>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Low Stock</span>
          </div>
          <div className="text-2xl font-bold text-zinc-900">{stats.lowStockCount}</div>
          <div className="mt-1 text-xs text-zinc-500">Items below minimum</div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 bg-zinc-50 text-zinc-600 rounded-lg"><DollarSign size={20} /></div>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Total Sales</span>
          </div>
          <div className="text-2xl font-bold text-zinc-900">Rs. {stats.totalSales.toLocaleString()}</div>
          <div className="mt-1 text-xs text-zinc-500">Gross revenue today</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
          <h3 className="font-serif italic text-lg text-zinc-800">Quick Stock Overview</h3>
          <button onClick={() => setActiveTab('inventory')} className="text-xs font-bold text-emerald-600 hover:underline">View All</button>
        </div>
        <div className="divide-y divide-zinc-100">
          {products.slice(0, 5).map(product => (
            <div key={product.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-zinc-900">{product.name}</div>
                <div className="text-xs text-zinc-500">{product.unit_type}</div>
              </div>
              <div className="text-right">
                <div className={`text-sm font-bold ${product.quantity <= product.min_stock ? 'text-red-600' : 'text-zinc-900'}`}>
                  {product.quantity} {product.unit_type === 'weight' ? 'kg' : product.unit_type === 'volume' ? 'L' : 'pcs'}
                </div>
                <div className="text-[10px] text-zinc-400">Available</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderSales = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
          <input 
            type="text" 
            placeholder="Search products..." 
            className="w-full pl-12 pr-4 py-3 bg-white border border-zinc-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {products
            .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map(product => (
              <button 
                key={product.id}
                onClick={() => addToCart(product)}
                className="bg-white p-4 rounded-xl border border-zinc-200 text-left hover:border-emerald-500 hover:shadow-md transition-all group"
              >
                <div className="text-sm font-bold text-zinc-900 group-hover:text-emerald-600">{product.name}</div>
                <div className="text-xs text-zinc-500 mt-1">Rs. {product.selling_price}</div>
                <div className="text-[10px] text-zinc-400 mt-2">Stock: {product.quantity}</div>
              </button>
            ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-lg flex flex-col h-[calc(100vh-12rem)]">
        <div className="p-6 border-b border-zinc-100">
          <h3 className="font-serif italic text-xl text-zinc-900">Current Bill</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {cart.map(item => (
            <div key={item.product_id} className="flex flex-col gap-2 p-3 bg-zinc-50 rounded-lg border border-zinc-100">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-zinc-900">{item.name}</span>
                <button onClick={() => removeFromCart(item.product_id)} className="text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-zinc-400 uppercase font-bold">Qty</label>
                  <input 
                    type="number" 
                    value={item.quantity || ''} 
                    onChange={(e) => updateCartItem(item.product_id, 'quantity', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                    className="w-full bg-white border border-zinc-200 rounded px-2 py-1 text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-zinc-400 uppercase font-bold">Price</label>
                  <input 
                    type="number" 
                    value={item.selling_price || ''} 
                    onChange={(e) => updateCartItem(item.product_id, 'selling_price', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                    className="w-full bg-white border border-zinc-200 rounded px-2 py-1 text-sm"
                  />
                </div>
              </div>
            </div>
          ))}
          {cart.length === 0 && (
            <div className="text-center py-12 text-zinc-400 italic text-sm">Cart is empty</div>
          )}
        </div>
        <div className="p-6 border-t border-zinc-100 bg-zinc-50/50 space-y-4">
          <div className="flex items-center justify-between font-bold text-lg">
            <span>Total</span>
            <span>Rs. {cart.reduce((sum, item) => sum + (item.quantity * item.selling_price), 0).toLocaleString()}</span>
          </div>
          <button 
            onClick={handleCheckout}
            disabled={cart.length === 0}
            className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-emerald-600/20"
          >
            Complete Sale
          </button>
        </div>
      </div>
    </div>
  );

  const renderInventory = () => (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
        <h2 className="text-2xl font-serif italic text-zinc-900">Inventory Management</h2>
        <button onClick={() => setActiveTab('stock-arrival')} className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
          <PlusCircle size={16} /> Add Stock
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-50/50 text-[11px] font-bold text-zinc-400 uppercase tracking-widest italic border-b border-zinc-100">
              <th className="px-6 py-4">Product Name</th>
              <th className="px-6 py-4">Unit</th>
              <th className="px-6 py-4">Cost Price</th>
              <th className="px-6 py-4">Selling Price</th>
              <th className="px-6 py-4">Stock</th>
              <th className="px-6 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {products.map(product => (
              <tr key={product.id} className="hover:bg-zinc-50 transition-colors">
                <td className="px-6 py-4">
                  {editingProduct?.id === product.id ? (
                    <input 
                      className="p-1 border rounded text-sm w-full" 
                      value={editingProduct.name} 
                      onChange={e => setEditingProduct({...editingProduct, name: e.target.value})}
                    />
                  ) : (
                    <span className="text-sm font-bold text-zinc-900">{product.name}</span>
                  )}
                </td>
                <td className="px-6 py-4 text-xs text-zinc-500 capitalize">{product.unit_type}</td>
                <td className="px-6 py-4 text-sm">
                  {editingProduct?.id === product.id ? (
                    <input 
                      type="number"
                      className="p-1 border rounded text-sm w-24" 
                      value={editingProduct.cost_price || ''} 
                      onChange={e => setEditingProduct({...editingProduct, cost_price: e.target.value === '' ? 0 : parseFloat(e.target.value)})}
                    />
                  ) : (
                    <span>Rs. {product.cost_price}</span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm">
                  {editingProduct?.id === product.id ? (
                    <input 
                      type="number"
                      className="p-1 border rounded text-sm w-24" 
                      value={editingProduct.selling_price || ''} 
                      onChange={e => setEditingProduct({...editingProduct, selling_price: e.target.value === '' ? 0 : parseFloat(e.target.value)})}
                    />
                  ) : (
                    <span>Rs. {product.selling_price}</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  {editingProduct?.id === product.id ? (
                    <input 
                      type="number"
                      className="p-1 border rounded text-sm w-24" 
                      value={editingProduct.quantity || ''} 
                      onChange={e => setEditingProduct({...editingProduct, quantity: e.target.value === '' ? 0 : parseFloat(e.target.value)})}
                    />
                  ) : (
                    <span className={`text-sm font-bold ${product.quantity <= product.min_stock ? 'text-red-600' : 'text-zinc-900'}`}>
                      {product.quantity}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  {editingProduct?.id === product.id ? (
                    <div className="flex gap-2">
                      <button onClick={handleUpdateProduct} className="text-emerald-600 hover:text-emerald-700"><Save size={16} /></button>
                      <button onClick={() => setEditingProduct(null)} className="text-zinc-400 hover:text-zinc-600"><X size={16} /></button>
                    </div>
                  ) : (
                    <button onClick={() => setEditingProduct(product)} className="text-emerald-600 hover:text-emerald-700"><Edit2 size={16} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderStockArrival = () => (
    <div className="space-y-8">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl border border-zinc-200 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-serif italic text-zinc-900">Stock Arrival</h2>
          <button 
            onClick={() => setIsNewProduct(!isNewProduct)}
            className="text-xs font-bold text-emerald-600 hover:underline"
          >
            {isNewProduct ? 'Add Existing Product' : 'Add New Product'}
          </button>
        </div>

        {isNewProduct ? (
          <form onSubmit={handleCreateProduct} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Product Name</label>
              <input 
                type="text" 
                className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                value={newProductForm.name}
                onChange={(e) => setNewProductForm({ ...newProductForm, name: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Unit Type</label>
                <select 
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  value={newProductForm.unit_type}
                  onChange={(e) => setNewProductForm({ ...newProductForm, unit_type: e.target.value as any })}
                >
                  <option value="unit">Unit (Packet)</option>
                  <option value="weight">Weight (kg)</option>
                  <option value="volume">Volume (L)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Initial Quantity</label>
                <input 
                  type="number" 
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  value={newProductForm.quantity || ''}
                  onChange={(e) => setNewProductForm({ ...newProductForm, quantity: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Cost Price</label>
                <input 
                  type="number" 
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  value={newProductForm.cost_price || ''}
                  onChange={(e) => setNewProductForm({ ...newProductForm, cost_price: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Selling Price</label>
                <input 
                  type="number" 
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  value={newProductForm.selling_price || ''}
                  onChange={(e) => setNewProductForm({ ...newProductForm, selling_price: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>
            <button type="submit" className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-colors">
              Create & Add Product
            </button>
          </form>
        ) : (
          <form onSubmit={handleStockArrival} className="space-y-4">
            <SearchableSelect 
              items={products}
              label="Select Product"
              placeholder="Type to search..."
              onSelect={(p) => setArrivalForm(prev => ({ ...prev, product_id: p.id }))}
            />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Quantity</label>
                <input 
                  type="number" 
                  step="0.01"
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  value={arrivalForm.quantity || ''}
                  onChange={(e) => setArrivalForm({ ...arrivalForm, quantity: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Cost Price (Unit)</label>
                <input 
                  type="number" 
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  value={arrivalForm.cost_price || ''}
                  onChange={(e) => setArrivalForm({ ...arrivalForm, cost_price: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
                  required
                />
              </div>
            </div>
            <button type="submit" className="w-full bg-zinc-900 text-white py-3 rounded-xl font-bold hover:bg-black transition-colors">
              Update Stock
            </button>
          </form>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50/50">
          <h3 className="font-serif italic text-lg text-zinc-800">Recent Stock Arrivals</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 text-[11px] font-bold text-zinc-400 uppercase tracking-widest italic border-b border-zinc-100">
                <th className="px-6 py-4">Product</th>
                <th className="px-6 py-4">Quantity</th>
                <th className="px-6 py-4">Cost Price</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {arrivalHistory.slice(0, 10).map(arrival => (
                <tr key={arrival.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-6 py-4 text-sm font-bold text-zinc-900">{arrival.product_name}</td>
                  <td className="px-6 py-4 text-sm">{arrival.quantity}</td>
                  <td className="px-6 py-4 text-sm">Rs. {arrival.cost_price}</td>
                  <td className="px-6 py-4 text-xs text-zinc-500">{new Date(arrival.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      type="button" 
                      onClick={(e) => handleUndoArrival(arrival.id, e)} 
                      className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all relative z-20"
                      title="Undo Arrival"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderWithdrawals = () => (
    <div className="space-y-8">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl border border-zinc-200 shadow-sm">
        <h2 className="text-2xl font-serif italic text-zinc-900 mb-6">Record Withdrawal</h2>
        <form onSubmit={handleWithdrawal} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Type</label>
            <div className="flex gap-4">
              <button 
                type="button"
                onClick={() => setWithdrawalForm({ ...withdrawalForm, type: 'cash' })}
                className={`flex-1 py-3 rounded-xl border font-bold transition-all ${withdrawalForm.type === 'cash' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-zinc-500 border-zinc-200'}`}
              >
                Cash
              </button>
              <button 
                type="button"
                onClick={() => setWithdrawalForm({ ...withdrawalForm, type: 'item' })}
                className={`flex-1 py-3 rounded-xl border font-bold transition-all ${withdrawalForm.type === 'item' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-zinc-500 border-zinc-200'}`}
              >
                Item
              </button>
            </div>
          </div>
          {withdrawalForm.type === 'item' && (
            <SearchableSelect 
              items={products}
              label="Select Item"
              placeholder="Type to search..."
              onSelect={(p) => setWithdrawalForm(prev => ({ ...prev, product_id: p.id }))}
            />
          )}
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Amount / Value</label>
            <input 
              type="number" 
              className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              value={withdrawalForm.amount || ''}
              onChange={(e) => setWithdrawalForm({ ...withdrawalForm, amount: e.target.value === '' ? 0 : parseFloat(e.target.value) })}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Description</label>
            <textarea 
              className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              rows={3}
              value={withdrawalForm.description}
              onChange={(e) => setWithdrawalForm({ ...withdrawalForm, description: e.target.value })}
              placeholder="Reason for withdrawal..."
            />
          </div>
          <div className="pt-4">
            <button type="submit" className="w-full bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-colors">
              Record Withdrawal
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50/50">
          <h3 className="font-serif italic text-lg text-zinc-800">Recent Withdrawals</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 text-[11px] font-bold text-zinc-400 uppercase tracking-widest italic border-b border-zinc-100">
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {withdrawalHistory.map(w => (
                <tr key={w.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-6 py-4 text-xs font-bold uppercase tracking-widest text-zinc-500">{w.type}</td>
                  <td className="px-6 py-4 text-sm font-bold text-red-600">Rs. {w.amount}</td>
                  <td className="px-6 py-4 text-sm text-zinc-600">{w.description}</td>
                  <td className="px-6 py-4 text-xs text-zinc-500">{new Date(w.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      type="button" 
                      onClick={(e) => handleUndoWithdrawal(w.id, e)} 
                      className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all relative z-20"
                      title="Undo Withdrawal"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderProfit = () => {
    const totalSalesProfit = saleHistory.reduce((sum, s) => sum + s.total_profit, 0);
    const totalWithdrawals = withdrawalHistory.reduce((sum, w) => sum + w.amount, 0);
    const netProfit = totalSalesProfit - totalWithdrawals;

    return (
      <div className="space-y-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><TrendingUp size={18} /></div>
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Sales Profit</span>
            </div>
            <div className="text-3xl font-bold text-zinc-900">Rs. {totalSalesProfit.toLocaleString()}</div>
            <div className="mt-2 text-xs text-zinc-500">Gross profit from all bills</div>
          </div>
          
          <div className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-50 text-red-600 rounded-lg"><MinusCircle size={18} /></div>
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Total Withdrawals</span>
            </div>
            <div className="text-3xl font-bold text-red-600">Rs. {totalWithdrawals.toLocaleString()}</div>
            <div className="mt-2 text-xs text-zinc-500">Cash & items taken from shop</div>
          </div>

          <div className="bg-emerald-600 p-6 rounded-2xl shadow-lg shadow-emerald-600/20 text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-white/20 text-white rounded-lg"><DollarSign size={18} /></div>
              <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Net Profit</span>
            </div>
            <div className="text-3xl font-bold">Rs. {netProfit.toLocaleString()}</div>
            <div className="mt-2 text-xs text-white/70">Final take-home profit today</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
              <h2 className="text-xl font-serif italic text-zinc-900">Recent Sales</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/50 text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100">
                    <th className="px-6 py-4">Bill</th>
                    <th className="px-6 py-4">Profit</th>
                    <th className="px-6 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {saleHistory.map(sale => (
                    <tr key={sale.id} className="hover:bg-zinc-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-zinc-900">#{sale.id.toString().padStart(4, '0')}</div>
                        <div className="text-[10px] text-zinc-400">{new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-emerald-600">Rs. {sale.total_profit.toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          type="button"
                          onClick={(e) => handleUndoSale(sale.id, e)}
                          className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all relative z-20"
                          title="Undo Sale"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {saleHistory.length === 0 && (
                    <tr><td colSpan={3} className="p-12 text-center text-zinc-400 italic text-sm">No sales today</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-zinc-100 bg-zinc-50/50">
              <h2 className="text-xl font-serif italic text-zinc-900">Recent Withdrawals</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/50 text-[10px] font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-100">
                    <th className="px-6 py-4">Reason</th>
                    <th className="px-6 py-4">Amount</th>
                    <th className="px-6 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {withdrawalHistory.map(w => (
                    <tr key={w.id} className="hover:bg-zinc-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-zinc-900">{w.description || 'No description'}</div>
                        <div className="text-[10px] text-zinc-400 capitalize">{w.type} withdrawal</div>
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-red-600">Rs. {w.amount.toLocaleString()}</td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          type="button"
                          onClick={(e) => handleUndoWithdrawal(w.id, e)}
                          className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all relative z-20"
                          title="Undo Withdrawal"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {withdrawalHistory.length === 0 && (
                    <tr><td colSpan={3} className="p-12 text-center text-zinc-400 italic text-sm">No withdrawals today</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex font-sans text-zinc-900">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-200 bg-white p-6 flex flex-col gap-8 hidden md:flex">
        <div className="flex items-center gap-2 px-2">
          <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
            <ShoppingCart size={18} />
          </div>
          <span className="font-serif italic text-xl font-bold tracking-tight">GroceryFlow</span>
        </div>

        <nav className="flex-1 space-y-1">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <SidebarItem icon={ShoppingCart} label="New Sale" active={activeTab === 'sales'} onClick={() => setActiveTab('sales')} />
          <div className="relative">
            <SidebarItem icon={Package} label="Inventory" active={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')} />
            {stats.lowStockCount > 0 && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm pointer-events-none">
                {stats.lowStockCount}
              </div>
            )}
          </div>
          <SidebarItem icon={PlusCircle} label="Stock Arrival" active={activeTab === 'stock-arrival'} onClick={() => setActiveTab('stock-arrival')} />
          <SidebarItem icon={MinusCircle} label="Withdrawals" active={activeTab === 'withdrawals'} onClick={() => setActiveTab('withdrawals')} />
          <SidebarItem icon={History} label="Profit History" active={activeTab === 'profit'} onClick={() => setActiveTab('profit')} />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="h-16 bg-white border-b border-zinc-200 px-8 flex items-center justify-between sticky top-0 z-10">
          <h1 className="text-sm font-bold text-zinc-400 uppercase tracking-widest italic">{activeTab.replace('-', ' ')}</h1>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs font-bold text-zinc-900">Admin User</div>
              <div className="text-[10px] text-zinc-400">Grocery Shop Manager</div>
            </div>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="w-8 h-8 border-4 border-zinc-200 border-t-emerald-600 rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  {activeTab === 'dashboard' && renderDashboard()}
                  {activeTab === 'sales' && renderSales()}
                  {activeTab === 'inventory' && renderInventory()}
                  {activeTab === 'stock-arrival' && renderStockArrival()}
                  {activeTab === 'withdrawals' && renderWithdrawals()}
                  {activeTab === 'profit' && renderProfit()}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
