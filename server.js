const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_ROOT = path.join(__dirname, 'public');

const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
});

app.use(express.static(FRONTEND_ROOT, {
  index: false
}));

// In-memory data store
const products = [
  { id: 1, name: 'Wireless Headphones', price: 79.99, category: 'electronics', image: 'headphones.svg', stock: 15 },
  { id: 2, name: 'Mechanical Keyboard', price: 129.99, category: 'electronics', image: 'keyboard.svg', stock: 8 },
  { id: 3, name: 'USB-C Hub', price: 49.99, category: 'electronics', image: 'hub.svg', stock: 25 },
  { id: 4, name: 'Monitor Stand', price: 89.99, category: 'accessories', image: 'stand.svg', stock: 12 },
  { id: 5, name: 'Webcam HD', price: 69.99, category: 'electronics', image: 'webcam.svg', stock: 20 },
  { id: 6, name: 'Mouse Pad XL', price: 24.99, category: 'accessories', image: 'mousepad.svg', stock: 50 }
];

// Session-based storage (carts and users per session)
const sessions = {};

// Middleware to ensure session exists
function ensureSession(req, res, next) {
  let sessionId = req.cookies.sessionId;
  
  if (!sessionId || !sessions[sessionId]) {
    sessionId = uuidv4();
    sessions[sessionId] = {
      cart: [],
      currentUser: null
    };
    res.cookie('sessionId', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction
    });
  }
  
  req.session = sessions[sessionId];
  req.sessionId = sessionId;
  next();
}

app.use(ensureSession);

// Global users list (shared across sessions for login)
let users = [
  { id: 1, email: 'demo@techmart.com', password: 'demo123', name: 'Demo User' }
];

// API Routes

// Get all products
app.get('/api/products', (req, res) => {
  const { category, search, minPrice, maxPrice } = req.query;
  let filtered = [...products];
  
  if (category && category !== 'all') {
    filtered = filtered.filter(p => p.category === category);
  }
  if (search) {
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(search.toLowerCase())
    );
  }
  if (minPrice) {
    filtered = filtered.filter(p => p.price >= parseFloat(minPrice));
  }
  if (maxPrice) {
    filtered = filtered.filter(p => p.price <= parseFloat(maxPrice));
  }
  
  res.json(filtered);
});

// Get single product
app.get('/api/products/:id', (req, res) => {
  const product = products.find(p => p.id === parseInt(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

// Get cart
app.get('/api/cart', (req, res) => {
  const cart = req.session.cart;
  const cartWithProducts = cart.map(item => {
    const product = products.find(p => p.id === item.productId);
    return { ...item, product };
  });
  const total = cartWithProducts.reduce((sum, item) => 
    sum + (item.product.price * item.quantity), 0
  );
  res.json({ items: cartWithProducts, total: total.toFixed(2) });
});

// Add to cart
app.post('/api/cart', (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const cart = req.session.cart;

  const parsedProductId = Number.parseInt(productId, 10);
  const parsedQuantity = Number.parseInt(quantity, 10);

  if (!Number.isInteger(parsedProductId) || !Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
    return res.status(400).json({ error: 'Invalid productId or quantity' });
  }
  
  const product = products.find(p => p.id === parsedProductId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  if (product.stock < parsedQuantity) {
    return res.status(400).json({ error: 'Insufficient stock' });
  }
  
  const existingItem = cart.find(item => item.productId === parsedProductId);
  if (existingItem) {
    existingItem.quantity += parsedQuantity;
  } else {
    cart.push({ productId: parsedProductId, quantity: parsedQuantity });
  }
  
  res.json({ message: 'Added to cart', cart });
});

// Update cart item
app.put('/api/cart/:productId', (req, res) => {
  const { quantity } = req.body;
  const productId = parseInt(req.params.productId);
  const cart = req.session.cart;

  const parsedQuantity = Number.parseInt(quantity, 10);

  if (!Number.isInteger(parsedQuantity)) {
    return res.status(400).json({ error: 'Invalid quantity' });
  }
  
  const item = cart.find(i => i.productId === productId);
  if (!item) {
    return res.status(404).json({ error: 'Item not in cart' });
  }
  
  if (parsedQuantity <= 0) {
    req.session.cart = cart.filter(i => i.productId !== productId);
  } else {
    item.quantity = parsedQuantity;
  }
  
  res.json({ message: 'Cart updated', cart: req.session.cart });
});

// Remove from cart
app.delete('/api/cart/:productId', (req, res) => {
  const productId = parseInt(req.params.productId);
  req.session.cart = req.session.cart.filter(item => item.productId !== productId);
  res.json({ message: 'Removed from cart', cart: req.session.cart });
});

// Clear cart
app.delete('/api/cart', (req, res) => {
  req.session.cart = [];
  res.json({ message: 'Cart cleared' });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  req.session.currentUser = user;
  res.json({ message: 'Login successful', user: { id: user.id, email: user.email, name: user.name } });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.currentUser = null;
  res.json({ message: 'Logged out' });
});

// Register
app.post('/api/register', (req, res) => {
  const { email, password, name } = req.body;
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'All fields required' });
  }
  
  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'Email already registered' });
  }
  
  const newUser = { id: users.length + 1, email, password, name };
  users.push(newUser);
  req.session.currentUser = newUser;
  
  res.status(201).json({ message: 'Registration successful', user: { id: newUser.id, email, name } });
});

// Get current user
app.get('/api/user', (req, res) => {
  if (!req.session.currentUser) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const user = req.session.currentUser;
  res.json({ id: user.id, email: user.email, name: user.name });
});

// Checkout
app.post('/api/checkout', (req, res) => {
  const cart = req.session.cart;
  
  if (cart.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }
  
  const { shipping: shippingAddress } = req.body;
  if (!shippingAddress || !shippingAddress.address || !shippingAddress.city || !shippingAddress.zip) {
    return res.status(400).json({ error: 'Shipping information required' });
  }
  
  // Calculate subtotal and total with conditional shipping fee
  const subtotal = cart.reduce((sum, item) => {
    const product = products.find(p => p.id === item.productId);
    return sum + (product.price * item.quantity);
  }, 0);
  const shippingFee = subtotal < 100 ? 20 : 0;
  const total = subtotal + shippingFee;
  
  // Update stock (note: in real app this should be transactional)
  cart.forEach(item => {
    const product = products.find(p => p.id === item.productId);
    product.stock -= item.quantity;
  });
  
  const order = {
    id: Date.now(),
    items: [...cart],
    subtotal: subtotal.toFixed(2),
    shippingFee: shippingFee.toFixed(2),
    total: total.toFixed(2),
    shipping: shippingAddress,
    date: new Date().toISOString()
  };
  
  req.session.cart = [];
  
  res.json({ message: 'Order placed successfully', order });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Frontend routes
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'index.html'));
});

app.get('/cart', (req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'cart.html'));
});

app.get('/checkout', (req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'checkout.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'register.html'));
});

// Fallback for non-API routes (SPA-friendly)
app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TechMart server running on http://localhost:${PORT}`);
});
