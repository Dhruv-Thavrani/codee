import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ShoppingCart, Search, User, Home, Package, Heart, LogOut, 
  ChevronRight, ChevronLeft, Edit, Trash2, Plus, Menu, X, 
  CheckCircle, Clock, MapPin, CreditCard, Tag, MessageCircle, Send,
  Store, LayoutDashboard, Settings, ArrowLeft, Lock
} from 'lucide-react';
import { 
  initializeApp 
} from 'firebase/app';
import { 
  getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged
} from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, getDoc, onSnapshot, addDoc, updateDoc, deleteDoc 
} from 'firebase/firestore';

// --- Firebase Initialization ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Extract the base workspace ID correctly to ensure accurate segment counts AND pass Firebase security rules.
let appId = typeof __app_id !== 'undefined' ? String(__app_id) : 'freshmart-platform';
if (appId.includes('_src')) {
  appId = appId.split('_src')[0];
} else if (appId.includes('/')) {
  appId = appId.split('/')[0];
}

// --- Seed Data ---
const initialProducts = [
  { id: '1', name: 'Organic Bananas', category: 'Produce', price: 2.99, stock: 50, featured: true, image: '🍌', description: 'Fresh organic bananas from Ecuador.' },
  { id: '2', name: 'Whole Milk (1 Gallon)', category: 'Dairy', price: 4.49, stock: 30, featured: true, image: '🥛', description: 'Vitamin D enriched whole milk.' },
  { id: '3', name: 'Sourdough Bread', category: 'Bakery', price: 5.99, stock: 15, featured: false, image: '🍞', description: 'Artisan sourdough baked fresh daily.' },
  { id: '4', name: 'Free-Range Eggs (Dozen)', category: 'Dairy', price: 6.49, stock: 40, featured: true, image: '🥚', description: 'Large brown eggs from free-range hens.' },
  { id: '5', name: 'Avocado', category: 'Produce', price: 1.99, stock: 100, featured: true, image: '🥑', description: 'Perfectly ripe Hass avocados.' },
  { id: '6', name: 'Extra Virgin Olive Oil', category: 'Pantry', price: 14.99, stock: 20, featured: false, image: '🫒', description: 'Cold-pressed extra virgin olive oil.' },
  { id: '7', name: 'Ground Coffee', category: 'Pantry', price: 9.99, stock: 25, featured: true, image: '☕', description: 'Dark roast Colombian arabica blend.' },
  { id: '8', name: 'Fresh Spinach', category: 'Produce', price: 3.49, stock: 40, featured: false, image: '🥬', description: 'Pre-washed baby spinach leaves.' },
];

const CATEGORIES = ['All', 'Produce', 'Dairy', 'Bakery', 'Pantry', 'Meat', 'Frozen'];

// --- Utility Components ---
const Toast = ({ message, type = 'success', onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600';
  
  return (
    <div className={`fixed top-20 right-4 sm:bottom-4 sm:top-auto ${bgColor} text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-2 z-50 animate-bounce`}>
      {type === 'success' && <CheckCircle size={20} />}
      <span>{String(message)}</span>
    </div>
  );
};

// ============================================================================
// ROOT APP COMPONENT (Router & Auth Manager)
// ============================================================================
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [appMode, setAppMode] = useState('shopper'); // 'shopper', 'sellerLogin', 'sellerApp'
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const showToast = (message, type = 'success') => setToast({ message: String(message), type });

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-green-600 font-bold">Loading Platform...</div>;
  }

  return (
    <div className="app-root">
      {appMode === 'shopper' && (
        <ShopperApp user={user} setAppMode={setAppMode} showToast={showToast} />
      )}
      {appMode === 'sellerLogin' && (
        <SellerLogin setAppMode={setAppMode} showToast={showToast} />
      )}
      {appMode === 'sellerApp' && (
        <SellerApp user={user} setAppMode={setAppMode} showToast={showToast} />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

// ============================================================================
// 1. SHOPPER APPLICATION
// ============================================================================
function ShopperApp({ user, setAppMode, showToast }) {
  const [currentView, setCurrentView] = useState('home');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [savedForLater, setSavedForLater] = useState([]);
  const [orders, setOrders] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    
    let unsubProducts = () => {};
    let unsubOrders = () => {};

    try {
      const productsRef = collection(db, 'artifacts', appId, 'public', 'data', 'products');
      unsubProducts = onSnapshot(productsRef, (snapshot) => {
        const prods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (prods.length === 0) seedProducts();
        else setProducts(prods);
      }, (error) => console.error("Products subscription error:", error));

      const ordersRef = collection(db, 'artifacts', appId, 'users', user.uid, 'orders');
      unsubOrders = onSnapshot(ordersRef, (snapshot) => {
        const userOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setOrders(userOrders.sort((a, b) => b.createdAt - a.createdAt));
      }, (error) => console.error("Orders subscription error:", error));
    } catch (err) {
      console.error("Failed to initialize subscriptions:", err);
    }

    return () => { unsubProducts(); unsubOrders(); };
  }, [user]);

  const seedProducts = async () => {
    try {
      const productsRef = collection(db, 'artifacts', appId, 'public', 'data', 'products');
      for (const p of initialProducts) {
        await setDoc(doc(productsRef, p.id), p);
      }
    } catch (error) {
      console.error("Failed to seed products", error);
    }
  };

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) return prev.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      return [...prev, { ...product, qty: 1 }];
    });
    showToast(`${product.name} added to cart`);
  };

  const updateCartQty = (id, delta) => setCart(prev => prev.map(item => item.id === id ? { ...item, qty: Math.max(1, item.qty + delta) } : item));
  const removeFromCart = (id) => setCart(prev => prev.filter(item => item.id !== id));
  
  const saveForLater = (item) => {
    removeFromCart(item.id);
    if (!savedForLater.find(i => i.id === item.id)) {
      setSavedForLater(prev => [...prev, item]);
      showToast(`${item.name} saved for later`);
    }
  };
  const moveToCart = (item) => {
    setSavedForLater(prev => prev.filter(i => i.id !== item.id));
    addToCart(item);
  };

  const cartTotal = cart.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * item.qty), 0);
  const cartItemCount = cart.reduce((sum, item) => sum + item.qty, 0);

  const filteredProducts = useMemo(() => {
    let result = products;
    if (selectedCategory !== 'All') result = result.filter(p => p.category === selectedCategory);
    if (searchQuery) result = result.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.category.toLowerCase().includes(searchQuery.toLowerCase()));
    return result;
  }, [products, selectedCategory, searchQuery]);

  const featuredProducts = useMemo(() => products.filter(p => p.featured), [products]);

  const navigate = (view) => { setCurrentView(view); setMobileMenuOpen(false); window.scrollTo(0, 0); };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-800 relative flex flex-col">
      <nav className="bg-white shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center cursor-pointer" onClick={() => navigate('home')}>
              <div className="w-10 h-10 bg-green-600 text-white rounded-xl flex items-center justify-center font-bold text-xl mr-2 shadow-sm">FM</div>
              <span className="font-bold text-2xl text-green-700 hidden sm:block tracking-tight">FreshMart</span>
            </div>

            <div className="hidden md:flex flex-1 max-w-xl mx-8">
              <div className="relative w-full">
                <input 
                  type="text" 
                  placeholder="Search for groceries..." 
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); if (currentView !== 'shop') navigate('shop'); }}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all bg-gray-50"
                />
                <Search className="absolute left-3 top-2.5 text-gray-400" size={20} />
              </div>
            </div>

            <div className="flex items-center space-x-4 sm:space-x-6">
              <button onClick={() => navigate('profile')} className="text-gray-600 hover:text-green-600 transition-colors"><User size={24} /></button>
              <button onClick={() => navigate('cart')} className="text-gray-600 hover:text-green-600 relative transition-colors">
                <ShoppingCart size={24} />
                {cartItemCount > 0 && <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center shadow-sm">{cartItemCount}</span>}
              </button>
              <button className="md:hidden text-gray-600" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>
        
        {mobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 px-4 py-3 space-y-3 shadow-md absolute w-full z-50">
            <div className="relative w-full">
              <input 
                type="text" placeholder="Search products..." value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); if (currentView !== 'shop') navigate('shop'); }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <Search className="absolute left-3 top-2.5 text-gray-400" size={20} />
            </div>
            <div className="flex flex-col space-y-2">
              <button onClick={() => navigate('home')} className="text-left py-2 font-medium text-gray-700 hover:text-green-600">Home</button>
              <button onClick={() => navigate('shop')} className="text-left py-2 font-medium text-gray-700 hover:text-green-600">Shop All</button>
              <button onClick={() => navigate('profile')} className="text-left py-2 font-medium text-gray-700 hover:text-green-600">My Profile</button>
            </div>
          </div>
        )}
      </nav>

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 w-full">
        {currentView === 'home' && <HomeView navigate={navigate} featuredProducts={featuredProducts} addToCart={addToCart} setSelectedCategory={setSelectedCategory} />}
        {currentView === 'shop' && <ShopView products={filteredProducts} categories={CATEGORIES} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory} addToCart={addToCart} />}
        {currentView === 'cart' && <CartView cart={cart} updateQty={updateCartQty} remove={removeFromCart} saveForLater={saveForLater} savedItems={savedForLater} moveToCart={moveToCart} total={cartTotal} navigate={navigate} />}
        {currentView === 'checkout' && <CheckoutView cart={cart} total={cartTotal} navigate={navigate} user={user} setCart={setCart} showToast={showToast} />}
        {currentView === 'profile' && <ProfileView user={user} orders={orders} navigate={navigate} showToast={showToast} setAppMode={setAppMode} />}
      </main>

      <footer className="hidden md:block bg-white border-t border-gray-200 mt-auto py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center text-sm text-gray-500 text-center md:text-left">
          <p>© 2026 FreshMart Inc. All rights reserved.</p>
          <div className="flex flex-wrap justify-center gap-4 mt-4 md:mt-0">
            <button className="font-bold hover:text-green-600">Privacy Policy</button>
            <button className="font-bold hover:text-green-600">Terms of Service</button>
            <button onClick={() => setAppMode('sellerLogin')} className="font-bold hover:text-green-600">
              Merchant Portal
            </button>
          </div>
        </div>
      </footer>

      <ChatBot />
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around py-3 pb-safe z-40 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
        <button onClick={() => navigate('home')} className={`flex flex-col items-center ${currentView === 'home' ? 'text-green-600' : 'text-gray-400'}`}><Home size={24} /><span className="text-[10px] mt-1 font-medium">Home</span></button>
        <button onClick={() => navigate('shop')} className={`flex flex-col items-center ${currentView === 'shop' ? 'text-green-600' : 'text-gray-400'}`}><Search size={24} /><span className="text-[10px] mt-1 font-medium">Shop</span></button>
        <button onClick={() => navigate('cart')} className={`flex flex-col items-center relative ${currentView === 'cart' ? 'text-green-600' : 'text-gray-400'}`}>
          <ShoppingCart size={24} />
          {cartItemCount > 0 && <span className="absolute -top-1 right-2 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center">{cartItemCount}</span>}
          <span className="text-[10px] mt-1 font-medium">Cart</span>
        </button>
        <button onClick={() => navigate('profile')} className={`flex flex-col items-center ${currentView === 'profile' ? 'text-green-600' : 'text-gray-400'}`}><User size={24} /><span className="text-[10px] mt-1 font-medium">Profile</span></button>
      </div>
    </div>
  );
}

// ============================================================================
// 2. SELLER LOGIN PORTAL
// ============================================================================
function SellerLogin({ setAppMode, showToast }) {
  const [passcode, setPasscode] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    if (passcode === 'admin123') {
      showToast('Welcome to Seller Central');
      setAppMode('sellerApp');
    } else {
      showToast('Invalid Merchant Passcode', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center text-indigo-600">
          <Store size={48} />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Seller Central</h2>
        <p className="mt-2 text-center text-sm text-gray-600">Manage your FreshMart inventory and orders.</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-xl rounded-2xl sm:px-10 border border-slate-100">
          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label className="block text-sm font-medium text-gray-700">Merchant Passcode</label>
              <div className="mt-1 relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock size={18} className="text-gray-400" />
                </div>
                <input 
                  type="password" 
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Enter 'admin123'"
                  required 
                  className="appearance-none block w-full pl-10 px-3 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-slate-50" 
                />
              </div>
            </div>

            <div>
              <button type="submit" className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors">
                Access Dashboard
              </button>
            </div>
          </form>
          
          <div className="mt-6 text-center">
            <button onClick={() => setAppMode('shopper')} className="text-sm font-medium text-indigo-600 hover:text-indigo-500 flex items-center justify-center w-full">
              <ArrowLeft size={16} className="mr-1" /> Return to Storefront
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 3. SELLER DASHBOARD APPLICATION
// ============================================================================
function SellerApp({ user, setAppMode, showToast }) {
  const [activeTab, setActiveTab] = useState('inventory'); 
  const [products, setProducts] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [formData, setFormData] = useState({ name: '', category: 'Produce', price: '', stock: '', image: '📦', description: '', featured: false });

  useEffect(() => {
    if (!user) return;
    
    let unsubProducts = () => {};
    let unsubOrders = () => {};

    try {
      const productsRef = collection(db, 'artifacts', appId, 'public', 'data', 'products');
      unsubProducts = onSnapshot(productsRef, (snapshot) => {
        setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (err) => console.error("Admin products sync error:", err));

      const ordersRef = collection(db, 'artifacts', appId, 'public', 'data', 'all_orders');
      unsubOrders = onSnapshot(ordersRef, (snapshot) => {
        const globalOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllOrders(globalOrders.sort((a, b) => b.createdAt - a.createdAt));
      }, (err) => console.error("Admin orders sync error:", err));
    } catch (err) {
      console.error("Failed to fetch admin data", err);
    }

    return () => { unsubProducts(); unsubOrders(); };
  }, [user]);

  const handleEdit = (product) => {
    setEditingItem(product.id);
    setFormData({ ...product });
    window.scrollTo(0, 0);
  };

  const handleDelete = async (id) => {
    if (confirm('Are you sure you want to delete this product?')) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', id));
        showToast('Product removed from catalog');
      } catch (err) {
        showToast('Error deleting product', 'error');
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const dataToSave = { ...formData, price: parseFloat(formData.price || 0), stock: parseInt(formData.stock || 0, 10) };
      const productsRef = collection(db, 'artifacts', appId, 'public', 'data', 'products');
      
      if (editingItem) {
        await updateDoc(doc(productsRef, editingItem), dataToSave);
        showToast('Product updated successfully');
      } else {
        await addDoc(productsRef, dataToSave);
        showToast('Product added successfully');
      }
      setEditingItem(null);
      setFormData({ name: '', category: 'Produce', price: '', stock: '', image: '📦', description: '', featured: false });
    } catch (err) {
      showToast('Error saving product', 'error');
    }
  };

  const updateOrderStatus = async (orderId, customerUserId, newStatus) => {
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'all_orders', orderId), { status: newStatus });
      await updateDoc(doc(db, 'artifacts', appId, 'users', customerUserId, 'orders', orderId), { status: newStatus });
      showToast('Order status synchronized');
    } catch (error) {
      showToast('Failed to update order', 'error');
    }
  };

  const logoutToStore = () => {
    setAppMode('shopper');
    showToast('Returned to storefront');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-slate-800">
      <aside className="w-64 bg-slate-900 text-slate-300 hidden md:flex flex-col flex-shrink-0 relative z-20 shadow-xl">
        <div className="h-16 flex items-center px-6 bg-slate-950 border-b border-slate-800">
          <Store className="text-indigo-500 mr-3" size={24} />
          <span className="text-white font-bold text-lg tracking-wide">Seller Central</span>
        </div>
        <div className="flex-1 py-6 px-4 space-y-2">
          <button onClick={() => setActiveTab('inventory')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'inventory' ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>
            <Package size={20} className="mr-3" /> Inventory
          </button>
          <button onClick={() => setActiveTab('orders')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'orders' ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-slate-800 hover:text-white'}`}>
            <ShoppingCart size={20} className="mr-3" /> All Orders
            {allOrders.filter(o => o.status === 'Processing').length > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {allOrders.filter(o => o.status === 'Processing').length}
              </span>
            )}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 z-10">
          <div className="flex items-center">
            <button className="md:hidden text-slate-500 mr-4" onClick={() => setMobileSidebarOpen(true)}>
              <Menu size={24} />
            </button>
            <h1 className="text-lg sm:text-xl font-bold text-slate-800 flex items-center">
              {activeTab === 'inventory' ? (
                <span className="flex items-center"><Package className="mr-2 text-indigo-600 hidden sm:block"/> Catalog Manager</span>
              ) : (
                <span className="flex items-center"><ShoppingCart className="mr-2 text-indigo-600 hidden sm:block"/> Order Fulfillment</span>
              )}
            </h1>
          </div>
          <div className="flex items-center space-x-2 sm:space-x-4">
             <button onClick={logoutToStore} className="flex items-center px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 font-medium transition-colors text-xs sm:text-sm">
                <ArrowLeft size={16} className="mr-1 sm:mr-1.5" /> Back to Store
             </button>
             <div className="hidden sm:flex w-8 h-8 bg-indigo-100 text-indigo-700 rounded-full items-center justify-center font-bold">A</div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-50">
          {activeTab === 'inventory' && (
            <div className="grid xl:grid-cols-3 gap-8">
              <div className="xl:col-span-1">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sticky top-6">
                  <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center">
                    {editingItem ? <span className="flex items-center"><Edit size={18} className="mr-2 text-indigo-600"/> Edit Product</span> : <span className="flex items-center"><Plus size={18} className="mr-2 text-indigo-600"/> Add New Product</span>}
                  </h2>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                      <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Price ($)</label>
                        <input required type="number" step="0.01" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} className="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Stock</label>
                        <input required type="number" value={formData.stock} onChange={e => setFormData({...formData, stock: e.target.value})} className="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                        <select value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} className="w-full border border-slate-300 rounded-lg p-2.5 bg-white focus:ring-2 focus:ring-indigo-500 outline-none">
                          {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Emoji Icon</label>
                        <input type="text" value={formData.image} onChange={e => setFormData({...formData, image: e.target.value})} className="w-full border border-slate-300 rounded-lg p-2.5 text-center text-xl focus:ring-2 focus:ring-indigo-500 outline-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                      <textarea rows="2" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"></textarea>
                    </div>
                    <div className="flex items-center mt-2">
                      <input type="checkbox" id="featured" checked={formData.featured} onChange={e => setFormData({...formData, featured: e.target.checked})} className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500" />
                      <label htmlFor="featured" className="ml-2 text-sm text-slate-700 font-medium">Feature on storefront homepage</label>
                    </div>
                    <div className="pt-4 flex gap-3">
                      <button type="submit" className="flex-1 bg-indigo-600 text-white py-2.5 rounded-lg font-bold shadow-sm hover:bg-indigo-700 transition-colors">
                        {editingItem ? 'Save Changes' : 'Create Product'}
                      </button>
                      {editingItem && (
                        <button type="button" onClick={() => { setEditingItem(null); setFormData({name: '', category: 'Produce', price: '', stock: '', image: '📦', description: '', featured: false}); }} className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-bold hover:bg-slate-200">
                          Cancel
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              </div>

              <div className="xl:col-span-2">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                          <th className="p-4">Product Details</th>
                          <th className="p-4">Price</th>
                          <th className="p-4">Inventory</th>
                          <th className="p-4 text-right">Manage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {products.map(product => (
                          <tr key={product.id} className="hover:bg-slate-50 transition-colors">
                            <td className="p-4 flex items-center space-x-4">
                              <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-2xl">{product.image}</div>
                              <div>
                                <p className="font-bold text-slate-800">{product.name}</p>
                                <div className="flex items-center mt-1 space-x-2">
                                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{product.category}</span>
                                  {product.featured && <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">Featured</span>}
                                </div>
                              </div>
                            </td>
                            <td className="p-4 font-medium text-slate-800">${parseFloat(product.price || 0).toFixed(2)}</td>
                            <td className="p-4">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${product.stock > 20 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : product.stock > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                {product.stock} units
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <button onClick={() => handleEdit(product)} className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-lg transition-colors inline-block mr-1" title="Edit">
                                <Edit size={18} />
                              </button>
                              <button onClick={() => handleDelete(product.id)} className="text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors inline-block" title="Delete">
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
               {allOrders.length === 0 ? (
                 <div className="p-16 text-center text-slate-500 flex flex-col items-center">
                    <ShoppingCart size={48} className="text-slate-300 mb-4" />
                    <p className="text-lg font-medium">No orders to fulfill yet.</p>
                 </div>
               ) : (
                 <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider border-b border-slate-200">
                          <th className="p-4">Order Info</th>
                          <th className="p-4">Customer Details</th>
                          <th className="p-4">Cart Value</th>
                          <th className="p-4">Fulfillment Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {allOrders.map(order => (
                          <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                            <td className="p-4">
                              <p className="font-bold text-slate-800 font-mono text-xs mb-1">#{String(order.id).substring(0,8).toUpperCase()}</p>
                              <p className="text-sm text-slate-600 flex items-center"><Clock size={14} className="mr-1"/> {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A'}</p>
                              <p className="text-xs text-slate-500 mt-1 capitalize border inline-block px-2 py-0.5 rounded bg-white">{order.method} • {order.date}</p>
                            </td>
                            <td className="p-4">
                              <p className="font-medium text-slate-800 flex items-center"><User size={14} className="mr-1 text-slate-400"/> {order.userEmail}</p>
                              {order.method === 'delivery' && order.address ? (
                                <p className="text-xs text-slate-500 mt-1 truncate max-w-[200px]" title={`${order.address.street}, ${order.address.city}`}>
                                  📍 {order.address.street}, {order.address.city}
                                </p>
                              ) : (
                                <p className="text-xs text-slate-500 mt-1">🏪 In-Store Pickup</p>
                              )}
                            </td>
                            <td className="p-4">
                              <p className="font-medium text-slate-800">{(order.items || []).length} items</p>
                              <p className="font-bold text-emerald-600">${parseFloat(order.total || 0).toFixed(2)}</p>
                            </td>
                            <td className="p-4">
                              <select 
                                value={order.status}
                                onChange={(e) => updateOrderStatus(order.id, order.userId, e.target.value)}
                                className={`p-2 rounded-lg text-sm font-bold border outline-none cursor-pointer focus:ring-2 focus:ring-indigo-500 shadow-sm ${
                                  order.status === 'Completed' || order.status === 'Delivered' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                  order.status === 'Shipped' || order.status === 'Ready for Pickup' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                  'bg-amber-50 text-amber-700 border-amber-200'
                                }`}
                              >
                                <option value="Processing">Processing</option>
                                <option value="Ready for Pickup">Ready for Pickup</option>
                                <option value="Shipped">Shipped</option>
                                <option value="Delivered">Delivered</option>
                                <option value="Completed">Completed</option>
                                <option value="Cancelled">Cancelled</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                 </div>
               )}
            </div>
          )}
        </main>
      </div>

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-slate-900/80" onClick={() => setMobileSidebarOpen(false)}></div>
          <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col relative shadow-2xl animate-fade-in-right">
             <div className="h-16 flex items-center justify-between px-6 bg-slate-950 border-b border-slate-800">
               <div className="flex items-center">
                <Store className="text-indigo-500 mr-3" size={24} />
                <span className="text-white font-bold text-lg">Seller Central</span>
               </div>
               <button onClick={() => setMobileSidebarOpen(false)}><X size={20}/></button>
             </div>
             <div className="flex-1 py-6 px-4 space-y-2">
              <button onClick={() => {setActiveTab('inventory'); setMobileSidebarOpen(false)}} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'inventory' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
                <Package size={20} className="mr-3" /> Inventory
              </button>
              <button onClick={() => {setActiveTab('orders'); setMobileSidebarOpen(false)}} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'orders' ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
                <ShoppingCart size={20} className="mr-3" /> All Orders
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SHOPPER SUB-COMPONENTS
// ============================================================================

function ProductCard({ product, addToCart }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow group flex flex-col h-full">
      <div className="h-48 bg-gray-50 flex items-center justify-center text-6xl group-hover:scale-110 transition-transform duration-300 relative">
        {product.image}
        {product.stock < 10 && <span className="absolute top-2 left-2 bg-orange-100 text-orange-800 text-xs font-bold px-2 py-1 rounded">Only {product.stock} left!</span>}
      </div>
      <div className="p-4 flex flex-col flex-grow">
        <span className="text-xs text-green-600 font-semibold uppercase tracking-wider mb-1">{product.category}</span>
        <h3 className="font-bold text-gray-800 mb-1 leading-tight">{product.name}</h3>
        <p className="text-gray-500 text-sm mb-4 line-clamp-2">{product.description}</p>
        <div className="mt-auto flex items-center justify-between">
          <span className="font-extrabold text-xl text-gray-900">${parseFloat(product.price || 0).toFixed(2)}</span>
          <button onClick={() => addToCart(product)} className="bg-green-600 hover:bg-green-700 text-white p-2.5 rounded-full shadow-sm transition-colors" aria-label="Add to cart"><Plus size={20} /></button>
        </div>
      </div>
    </div>
  );
}

function HomeView({ navigate, featuredProducts, addToCart, setSelectedCategory }) {
  const handleCategoryClick = (cat) => { setSelectedCategory(cat); navigate('shop'); };
  return (
    <div className="space-y-10 animate-fade-in">
      <div className="relative rounded-3xl overflow-hidden shadow-lg bg-green-700 text-white">
        <div className="absolute inset-0 bg-gradient-to-r from-green-800 to-transparent opacity-90"></div>
        <div className="relative z-10 px-8 py-16 md:py-24 max-w-2xl">
          <span className="inline-block py-1 px-3 rounded-full bg-green-500 text-sm font-bold tracking-wide mb-4">WEEKLY SPECIALS</span>
          <h1 className="text-4xl md:text-5xl font-extrabold mb-4 leading-tight">Fresh Groceries,<br/>Delivered to You.</h1>
          <p className="text-green-100 text-lg mb-8 max-w-md">Get 20% off your first order of organic produce and farm-fresh dairy.</p>
          <button onClick={() => navigate('shop')} className="bg-white text-green-700 font-bold py-3 px-8 rounded-full shadow-md hover:bg-gray-50 transition-colors flex items-center space-x-2"><span>Shop Now</span><ChevronRight size={20} /></button>
        </div>
        <div className="absolute right-[-10%] bottom-[-20%] text-[200px] opacity-20 transform rotate-12 pointer-events-none hidden md:block">🥬</div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Shop by Category</h2>
          <button onClick={() => navigate('shop')} className="text-green-600 font-medium hover:underline flex items-center">View All <ChevronRight size={16} /></button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[ { name: 'Produce', icon: '🍎', color: 'bg-red-50' }, { name: 'Dairy', icon: '🧀', color: 'bg-yellow-50' }, { name: 'Bakery', icon: '🥐', color: 'bg-orange-50' }, { name: 'Pantry', icon: '🥫', color: 'bg-blue-50' } ].map(cat => (
            <button key={cat.name} onClick={() => handleCategoryClick(cat.name)} className={`${cat.color} rounded-2xl p-6 flex flex-col items-center justify-center hover:shadow-md transition-all group`}>
              <span className="text-4xl mb-3 group-hover:scale-110 transition-transform">{cat.icon}</span><span className="font-semibold text-gray-800">{cat.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Featured Products</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {featuredProducts.slice(0, 4).map(product => <ProductCard key={product.id} product={product} addToCart={addToCart} />)}
        </div>
      </section>
    </div>
  );
}

function ShopView({ products, categories, selectedCategory, setSelectedCategory, addToCart }) {
  return (
    <div className="animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <h1 className="text-3xl font-bold text-gray-800">{selectedCategory === 'All' ? 'All Products' : selectedCategory}</h1>
        <div className="flex overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 md:pb-0 space-x-2 hide-scrollbar">
          {categories.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat)} className={`whitespace-nowrap px-4 py-2 rounded-full font-medium text-sm transition-colors ${selectedCategory === cat ? 'bg-green-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:border-green-500 hover:text-green-600'}`}>{cat}</button>
          ))}
        </div>
      </div>

      {products.length === 0 ? (
        <div className="text-center py-20"><div className="text-6xl mb-4">🔍</div><h3 className="text-xl font-bold text-gray-700">No products found</h3><p className="text-gray-500">Try adjusting your category or search terms.</p></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {products.map(product => <ProductCard key={product.id} product={product} addToCart={addToCart} />)}
        </div>
      )}
    </div>
  );
}

function CartView({ cart, updateQty, remove, saveForLater, savedItems, moveToCart, total, navigate }) {
  if (cart.length === 0 && savedItems.length === 0) {
    return (
      <div className="text-center py-20 animate-fade-in">
        <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6"><ShoppingCart size={40} className="text-gray-400" /></div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Your cart is empty</h2>
        <button onClick={() => navigate('shop')} className="mt-6 bg-green-600 text-white px-8 py-3 rounded-full font-bold hover:bg-green-700">Start Shopping</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-8 animate-fade-in">
      <div className="flex-1 space-y-8">
        {cart.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">Shopping Cart <span className="text-sm font-normal text-gray-500 ml-3">({cart.length} items)</span></h2>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {cart.map(item => (
                  <li key={item.id} className="p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="w-20 h-20 bg-gray-50 rounded-xl flex items-center justify-center text-4xl shrink-0">{item.image}</div>
                    <div className="flex-1 min-w-0"><h4 className="font-bold text-gray-800 text-lg truncate">{item.name}</h4><p className="text-green-600 font-bold">${parseFloat(item.price || 0).toFixed(2)}</p></div>
                    <div className="flex items-center space-x-4 w-full sm:w-auto justify-between sm:justify-end mt-4 sm:mt-0">
                      <div className="flex items-center border border-gray-200 rounded-full bg-white">
                        <button onClick={() => updateQty(item.id, -1)} className="p-2 text-gray-500 hover:text-green-600"><ChevronLeft size={16}/></button>
                        <span className="w-8 text-center font-medium text-gray-800">{item.qty}</span>
                        <button onClick={() => updateQty(item.id, 1)} className="p-2 text-gray-500 hover:text-green-600"><ChevronRight size={16}/></button>
                      </div>
                      <span className="font-bold text-gray-800 w-16 text-right">${(parseFloat(item.price || 0) * item.qty).toFixed(2)}</span>
                    </div>
                    <div className="flex space-x-2 w-full sm:w-auto justify-end sm:ml-4 border-t sm:border-0 pt-3 sm:pt-0 mt-3 sm:mt-0">
                      <button onClick={() => saveForLater(item)} className="text-gray-400 hover:text-blue-500 p-2"><Heart size={20} /></button>
                      <button onClick={() => remove(item.id)} className="text-gray-400 hover:text-red-500 p-2"><Trash2 size={20} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {savedItems.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-4">Saved for Later</h2>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <ul className="divide-y divide-gray-100">
                {savedItems.map(item => (
                  <li key={item.id} className="p-4 flex items-center gap-4 opacity-75">
                    <div className="w-16 h-16 bg-gray-50 rounded-xl flex items-center justify-center text-3xl">{item.image}</div>
                    <div className="flex-1"><h4 className="font-bold text-gray-800">{item.name}</h4><p className="text-gray-500 text-sm">${parseFloat(item.price || 0).toFixed(2)}</p></div>
                    <button onClick={() => moveToCart(item)} className="text-green-600 font-medium hover:bg-green-50 px-4 py-2 rounded-lg border border-green-200">Move to Cart</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="w-full lg:w-80 shrink-0">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sticky top-24">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Order Summary</h3>
            <div className="space-y-3 text-sm text-gray-600 border-b border-gray-100 pb-4 mb-4">
              <div className="flex justify-between"><span>Subtotal</span><span className="font-medium text-gray-800">${total.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>Estimated Tax (8%)</span><span className="font-medium text-gray-800">${(total * 0.08).toFixed(2)}</span></div>
            </div>
            <div className="flex justify-between items-end mb-6">
              <span className="text-lg font-bold text-gray-800">Total</span><span className="text-2xl font-extrabold text-green-600">${(total * 1.08).toFixed(2)}</span>
            </div>
            <button onClick={() => navigate('checkout')} className="w-full bg-green-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-green-700 flex items-center justify-center">
              <span>Checkout</span><ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckoutView({ cart, total, navigate, user, setCart, showToast }) {
  const [method, setMethod] = useState('delivery');
  const [address, setAddress] = useState({ street: '', city: '', zip: '' });
  const [date, setDate] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
    setDate(tmrw.toISOString().split('T')[0]);

    if (user) {
      const fetchProfile = async () => {
        try {
          const docSnap = await getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'details'));
          if (docSnap.exists()) {
            const data = docSnap.data();
            setAddress({ street: data.street || '', city: data.city || '', zip: data.zip || '' });
          }
        } catch (err) {
          console.error("Profile fetch error", err);
        }
      };
      fetchProfile();
    }
  }, [user]);

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (!user) return;
    setProcessing(true);
    
    try {
      const orderData = {
        items: cart, total: total * 1.08, method, date,
        address: method === 'delivery' ? address : null,
        status: 'Processing', createdAt: Date.now(), userId: user.uid, userEmail: user.email || 'Guest User'
      };

      const privateOrdersRef = collection(db, 'artifacts', appId, 'users', user.uid, 'orders');
      const newOrderDoc = await addDoc(privateOrdersRef, orderData);
      
      const publicOrdersRef = collection(db, 'artifacts', appId, 'public', 'data', 'all_orders');
      await setDoc(doc(publicOrdersRef, newOrderDoc.id), orderData);
      
      setCart([]); showToast('Order placed successfully!'); navigate('profile');
    } catch (err) {
      showToast('Error processing order', 'error');
    } finally {
      setProcessing(false);
    }
  };

  if (cart.length === 0) { navigate('cart'); return null; }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <button onClick={() => navigate('cart')} className="text-gray-500 hover:text-green-600 flex items-center mb-6"><ChevronLeft size={20} /> Back to Cart</button>
      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b border-gray-100 pb-4">Checkout Options</h2>
            <form id="checkout-form" onSubmit={handleCheckout} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <button type="button" onClick={() => setMethod('delivery')} className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center ${method === 'delivery' ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500'}`}><MapPin size={28} className="mb-2" /><span className="font-bold">Home Delivery</span></button>
                <button type="button" onClick={() => setMethod('pickup')} className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center ${method === 'pickup' ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500'}`}><Package size={28} className="mb-2" /><span className="font-bold">Store Pickup</span></button>
              </div>

              {method === 'delivery' && (
                <div className="space-y-4">
                  <h3 className="font-bold text-gray-700">Delivery Address</h3>
                  <input required type="text" placeholder="Street Address" value={address.street} onChange={e => setAddress({...address, street: e.target.value})} className="w-full border border-gray-300 rounded-lg p-3" />
                  <div className="grid grid-cols-2 gap-4">
                    <input required type="text" placeholder="City" value={address.city} onChange={e => setAddress({...address, city: e.target.value})} className="w-full border border-gray-300 rounded-lg p-3" />
                    <input required type="text" placeholder="ZIP" value={address.zip} onChange={e => setAddress({...address, zip: e.target.value})} className="w-full border border-gray-300 rounded-lg p-3" />
                  </div>
                </div>
              )}

              <div className="space-y-4 border-t border-gray-100 pt-6">
                <h3 className="font-bold text-gray-700 flex items-center"><Clock size={18} className="mr-2" /> Delivery / Pickup Date</h3>
                <input required type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3" />
              </div>

              <div className="space-y-4 border-t border-gray-100 pt-6">
                <h3 className="font-bold text-gray-700 flex items-center"><CreditCard size={18} className="mr-2" /> Payment</h3>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">Demo checkout. No real payment is processed.</div>
              </div>
            </form>
          </div>
        </div>

        <div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sticky top-24">
            <h3 className="font-bold text-gray-800 mb-4 border-b border-gray-100 pb-2">Total</h3>
            <div className="flex justify-between items-end mb-6"><span className="text-2xl font-extrabold text-green-600">${(total * 1.08).toFixed(2)}</span></div>
            <button type="submit" form="checkout-form" disabled={processing} className={`w-full py-4 rounded-xl font-bold text-lg text-white flex justify-center items-center ${processing ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'}`}>
              {processing ? 'Processing...' : <span className="flex items-center"><CheckCircle size={20} className="mr-2" /> Place Order</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileView({ user, orders, navigate, showToast, setAppMode }) {
  const [activeTab, setActiveTab] = useState('orders');
  const [profileData, setProfileData] = useState({ name: '', street: '', city: '', zip: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetchProfile = async () => {
      try {
        const docSnap = await getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'details'));
        if (docSnap.exists()) setProfileData(docSnap.data());
      } catch (err) {
        console.error("Profile view error", err);
      }
    };
    fetchProfile();
  }, [user]);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'details'), profileData);
      showToast('Profile saved successfully!');
    } catch (err) {
      showToast('Failed to save profile', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <div className="text-center py-20">Please log in to view your profile.</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 flex flex-col md:flex-row items-center gap-6">
        <div className="w-24 h-24 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-3xl font-bold">
          {profileData.name ? profileData.name.charAt(0).toUpperCase() : (user?.email ? user.email.charAt(0).toUpperCase() : 'U')}
        </div>
        <div className="text-center md:text-left flex-1">
          <h1 className="text-2xl font-bold text-gray-800">Hello, {profileData.name || 'Shopper'}</h1>
          <p className="text-gray-500">Account ID: {user.uid.substring(0,8)}</p>
        </div>
      </div>

      <div className="flex space-x-6 border-b border-gray-200">
        <button className={`pb-3 font-bold transition-colors ${activeTab === 'orders' ? 'border-b-2 border-green-600 text-green-600' : 'text-gray-500 hover:text-gray-700'}`} onClick={() => setActiveTab('orders')}>My Orders</button>
        <button className={`pb-3 font-bold transition-colors ${activeTab === 'profile' ? 'border-b-2 border-green-600 text-green-600' : 'text-gray-500 hover:text-gray-700'}`} onClick={() => setActiveTab('profile')}>Manage Profile</button>
      </div>

      {activeTab === 'orders' && (
        <div>
          {orders.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
              <Package size={48} className="mx-auto text-gray-300 mb-4" /><h3 className="text-xl font-bold text-gray-700 mb-2">No orders yet</h3>
              <button onClick={() => navigate('shop')} className="mt-4 bg-green-600 text-white px-6 py-2 rounded-full">Browse Products</button>
            </div>
          ) : (
            <div className="space-y-6">
              {orders.map(order => (
                <div key={order.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="bg-gray-50 px-6 py-4 border-b border-gray-100 flex flex-col sm:flex-row justify-between gap-4">
                    <div><span className="text-sm text-gray-500 block">Placed</span><span className="font-bold">{order.createdAt ? new Date(order.createdAt).toLocaleDateString() : 'N/A'}</span></div>
                    <div><span className="text-sm text-gray-500 block">Total</span><span className="font-bold text-green-600">${parseFloat(order.total || 0).toFixed(2)}</span></div>
                    <div><span className="text-sm text-gray-500 block">Method</span><span className="font-medium capitalize">{order.method} | {order.date}</span></div>
                    <div className="text-right">
                      <span className={`inline-block text-xs px-3 py-1 rounded-full font-bold uppercase ${['Completed', 'Delivered'].includes(order.status) ? 'bg-green-100 text-green-800' : ['Shipped', 'Ready for Pickup'].includes(order.status) ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}>{order.status}</span>
                    </div>
                  </div>
                  <div className="p-6 flex overflow-x-auto space-x-4 hide-scrollbar">
                    {(order.items || []).map((item, idx) => (
                      <div key={idx} className="flex-shrink-0 w-24 flex flex-col items-center">
                        <div className="w-16 h-16 bg-gray-50 rounded-xl flex items-center justify-center text-2xl mb-2">{item.image}</div>
                        <span className="text-xs text-center font-medium line-clamp-1">{item.name}</span><span className="text-xs text-gray-400">Qty: {item.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'profile' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-gray-800 mb-6">Personal Details</h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Full Name</label>
              <input required type="text" value={profileData.name} onChange={e => setProfileData({...profileData, name: e.target.value})} className="w-full border border-gray-300 rounded-lg p-3" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Default Street Address</label>
              <input required type="text" value={profileData.street} onChange={e => setProfileData({...profileData, street: e.target.value})} className="w-full border border-gray-300 rounded-lg p-3" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">City</label>
                <input required type="text" value={profileData.city} onChange={e => setProfileData({...profileData, city: e.target.value})} className="w-full border border-gray-300 rounded-lg p-3" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">ZIP Code</label>
                <input required type="text" value={profileData.zip} onChange={e => setProfileData({...profileData, zip: e.target.value})} className="w-full border border-gray-300 rounded-lg p-3" />
              </div>
            </div>
            <div className="pt-4">
              <button type="submit" disabled={saving} className={`px-8 py-3 rounded-full font-bold text-white transition-colors ${saving ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'}`}>
                {saving ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="mt-12 border-t border-gray-100 pt-8">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 px-2">App Settings & Legal</h3>
        <div className="space-y-3">
          <button className="w-full flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow text-left">
            <span className="font-bold text-gray-700">Privacy Policy</span>
            <ChevronRight size={18} className="text-gray-400" />
          </button>
          <button className="w-full flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow text-left">
            <span className="font-bold text-gray-700">Terms of Service</span>
            <ChevronRight size={18} className="text-gray-400" />
          </button>
          <button onClick={() => setAppMode('sellerLogin')} className="w-full flex items-center justify-between p-4 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow text-left">
            <span className="font-bold text-gray-700">Merchant Portal</span>
            <ChevronRight size={18} className="text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([{ sender: 'bot', text: 'Hi! Welcome to FreshMart. How can I help you today?' }]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, isOpen]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const userText = input.trim();
    setMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setInput('');
    setTimeout(() => {
      let botReply = "Please leave your email and our agents will get back to you.";
      const lower = userText.toLowerCase();
      if (lower.includes('order') || lower.includes('track')) botReply = "You can track your order status in your Profile under 'Order History'.";
      else if (lower.includes('delivery')) botReply = "We offer local home delivery and in-store pickup!";
      setMessages(prev => [...prev, { sender: 'bot', text: botReply }]);
    }, 800);
  };

  return (
    <div className="fixed bottom-20 right-4 md:bottom-8 md:right-8 z-50">
      {!isOpen && <button onClick={() => setIsOpen(true)} className="bg-green-600 text-white p-4 rounded-full shadow-lg hover:bg-green-700 transition-transform"><MessageCircle size={28} /></button>}
      {isOpen && (
        <div className="bg-white rounded-2xl shadow-2xl w-80 md:w-96 overflow-hidden flex flex-col border border-gray-100" style={{ height: '450px' }}>
          <div className="bg-green-600 text-white p-4 flex justify-between items-center"><span className="font-bold">FreshMart Support</span><button onClick={() => setIsOpen(false)}><X size={20} /></button></div>
          <div className="flex-1 p-4 overflow-y-auto bg-gray-50 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${msg.sender === 'user' ? 'bg-green-600 text-white rounded-br-none' : 'bg-white border text-gray-800 rounded-bl-none shadow-sm'}`}>{msg.text}</div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div className="p-3 bg-white border-t border-gray-100">
            <form onSubmit={handleSend} className="flex space-x-2">
              <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message..." className="flex-1 border rounded-full px-4 text-sm outline-none" />
              <button type="submit" disabled={!input.trim()} className="bg-green-600 text-white p-2.5 rounded-full"><Send size={18} /></button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}