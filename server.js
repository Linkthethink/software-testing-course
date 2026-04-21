require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_ROOT = path.join(__dirname, 'public');
const SENDPROMOTION_WEBHOOK_URL = process.env.SENDPROMOTION_WEBHOOK_URL || 'https://www.sendpromotion.email/api/v1/api/webhooks/sendpromotion';
const SENDPROMOTION_API_KEY = process.env.SENDPROMOTION_API_KEY || '';
const SENDPROMOTION_API_KEY_HEADER = process.env.SENDPROMOTION_API_KEY_HEADER || 'Authorization';
const SENDPROMOTION_API_KEY_PREFIX = process.env.SENDPROMOTION_API_KEY_PREFIX || 'Bearer';
const SENDPROMOTION_SIGNING_SECRET = process.env.SENDPROMOTION_SIGNING_SECRET || '';

const isProduction = process.env.NODE_ENV === 'production';

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));
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

app.use('/og_image', express.static(path.join(__dirname, 'og_image')));

// In-memory data store
const products = [
  {
    id: 1,
    name: 'Wireless Headphones',
    price: 79.99,
    category: 'electronics',
    image: 'headphones.svg',
    description: 'Comfort-fit wireless headphones with clear sound and long battery life.',
    stock: 15
  },
  {
    id: 2,
    name: 'Mechanical Keyboard',
    price: 129.99,
    category: 'electronics',
    image: 'keyboard.svg',
    description: 'Tactile mechanical keyboard built for fast typing and daily productivity.',
    stock: 8
  },
  {
    id: 3,
    name: 'USB-C Hub',
    price: 49.99,
    category: 'electronics',
    image: 'hub.svg',
    description: 'Multi-port USB-C hub for charging, data transfer, and display output.',
    stock: 25
  },
  {
    id: 4,
    name: 'Monitor Stand',
    price: 89.99,
    category: 'accessories',
    image: 'stand.svg',
    description: 'Adjustable monitor stand that improves desk ergonomics and organization.',
    stock: 12
  },
  {
    id: 5,
    name: 'Webcam HD',
    price: 69.99,
    category: 'electronics',
    image: 'webcam.svg',
    description: 'HD webcam with crisp video quality for meetings and streaming.',
    stock: 20
  },
  {
    id: 6,
    name: 'Mouse Pad XL',
    price: 24.99,
    category: 'accessories',
    image: 'mousepad.svg',
    description: 'Extra-large mouse pad with smooth glide surface and anti-slip base.',
    stock: 50
  },
  {
    id: 7,
    name: '14" LCD Computer Monitor',
    price: 119.99,
    category: 'electronics',
    image: 'monitor14.svg',
    description: 'Compact 14-inch LCD monitor with sharp display for work and home setups.',
    stock: 0
  }
];

// Session-based storage (carts and users per session)
const sessions = {};
const subscriptions = [];

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

// Get subscription list
app.get('/api/subscriptions', (req, res) => {
  const { search = '' } = req.query;
  const normalizedSearch = String(search).trim().toLowerCase();

  const items = normalizedSearch
    ? subscriptions.filter(item => item.email.toLowerCase().includes(normalizedSearch))
    : subscriptions;

  res.json({
    count: items.length,
    items: items
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  });
});

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
  
  const { shipping: shippingAddress, couponCode } = req.body;
  if (!shippingAddress || !shippingAddress.address || !shippingAddress.city || !shippingAddress.zip) {
    return res.status(400).json({ error: 'Shipping information required' });
  }

  const normalizedCouponCode = typeof couponCode === 'string' ? couponCode.trim().toUpperCase() : '';
  const discount = normalizedCouponCode === '15OFF' ? 15 : 0;
  
  // Calculate subtotal and total with conditional shipping fee
  const subtotal = cart.reduce((sum, item) => {
    const product = products.find(p => p.id === item.productId);
    return sum + (product.price * item.quantity);
  }, 0);
  const shippingFee = subtotal < 100 ? 20 : 0;
  const total = Math.max(0, subtotal + shippingFee - discount);
  
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
    discount: discount.toFixed(2),
    couponCode: discount > 0 ? normalizedCouponCode : null,
    total: total.toFixed(2),
    shipping: shippingAddress,
    date: new Date().toISOString()
  };
  
  req.session.cart = [];
  
  res.json({ message: 'Order placed successfully', order });
});

// Send subscription payload to SendPromotion API
app.post('/api/subscribe', async (req, res) => {
  const { email } = req.body || {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Please provide a valid email address' });
  }

  const payload = {
    email: normalizedEmail,
    source: 'techmart-demo-store',
    subscribedAt: new Date().toISOString()
  };

  const subscriptionRecord = {
    id: Date.now(),
    email: normalizedEmail,
    source: 'website-footer-form',
    status: 'pending',
    createdAt: new Date().toISOString(),
    lastWebhookEvent: null,
    lastWebhookEventAt: null
  };
  subscriptions.push(subscriptionRecord);

  try {
    const outboundHeaders = {
      'Content-Type': 'application/json'
    };

    if (SENDPROMOTION_API_KEY) {
      const authValue = SENDPROMOTION_API_KEY_PREFIX
        ? `${SENDPROMOTION_API_KEY_PREFIX} ${SENDPROMOTION_API_KEY}`
        : SENDPROMOTION_API_KEY;
      outboundHeaders[SENDPROMOTION_API_KEY_HEADER] = authValue;
    }

    const upstreamResponse = await fetch(SENDPROMOTION_WEBHOOK_URL, {
      method: 'POST',
      headers: outboundHeaders,
      body: JSON.stringify(payload)
    });

    if (!upstreamResponse.ok) {
      const errorBody = await upstreamResponse.text();
      subscriptionRecord.status = 'failed';
      subscriptionRecord.lastError = errorBody || `Webhook status ${upstreamResponse.status}`;
      return res.status(502).json({
        error: 'Failed to send subscription to webhook',
        details: errorBody || `Webhook status ${upstreamResponse.status}`
      });
    }

    subscriptionRecord.status = 'sent';
    res.status(200).json({ message: 'Subscription submitted successfully' });
  } catch (error) {
    console.error('SendPromotion webhook error:', error);
    subscriptionRecord.status = 'failed';
    subscriptionRecord.lastError = error.message;
    res.status(502).json({ error: 'Unable to reach webhook service' });
  }
});

// Receive SendPromotion outbound webhooks
app.post('/api/webhooks/sendpromotion', (req, res) => {
  const signatureHeader = req.get('X-SendPromotion-Signature') || '';

  if (SENDPROMOTION_SIGNING_SECRET) {
    if (!signatureHeader) {
      return res.status(401).json({ error: 'Missing X-SendPromotion-Signature header' });
    }

    const payload = req.rawBody || JSON.stringify(req.body || {});
    const expected = crypto
      .createHmac('sha256', SENDPROMOTION_SIGNING_SECRET)
      .update(payload)
      .digest('hex');

    const normalizedSignature = signatureHeader.startsWith('sha256=')
      ? signatureHeader.slice('sha256='.length)
      : signatureHeader;

    if (normalizedSignature.length !== expected.length) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(normalizedSignature, 'utf8');
    const valid = crypto.timingSafeEqual(expectedBuffer, actualBuffer);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const eventName = req.body && (req.body.event || req.body.type || 'unknown');
  const eventEmail = req.body && (
    req.body.email ||
    (req.body.contact && req.body.contact.email) ||
    (req.body.data && req.body.data.email)
  );

  if (eventEmail && typeof eventEmail === 'string') {
    const normalizedEventEmail = eventEmail.trim().toLowerCase();
    const matching = subscriptions.find(item => item.email === normalizedEventEmail);

    if (matching) {
      matching.lastWebhookEvent = eventName;
      matching.lastWebhookEventAt = new Date().toISOString();
    }
  }

  console.log('SendPromotion webhook received:', eventName);

  // Acknowledge quickly so sender retries are avoided.
  res.status(200).json({ received: true });
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

app.get('/subscriptions', (req, res) => {
  res.sendFile(path.join(FRONTEND_ROOT, 'subscriptions.html'));
});

// Fallback for non-API routes (SPA-friendly)
app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Return consistent JSON for malformed JSON bodies.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON request body' });
  }
  return next(err);
});

app.listen(PORT, () => {
  console.log(`TechMart server running on http://localhost:${PORT}`);
});
