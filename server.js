const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const db = require('./db');

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sales_inventory_secret_key_2026';

// Security Headers via Helmet
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
                imgSrc: ["'self'", "data:", "blob:"],
                connectSrc: ["'self'"],
            },
        },
        crossOriginEmbedderPolicy: false,
    })
);

// General Rate Limiter (200 requests per 15 min per IP)
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', generalLimiter);

// Specific Login Brute-force Protection (15 attempts per 15 min)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' }
});

// Middleware
app.use(cors({
    origin: true, // Echo origin or adjust to localhost:3000
    credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Access token required. Please login.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Session expired or invalid token.' });
        }
        req.user = user;
        next();
    });
}

// ----------------------------------------------------
// SYSTEM & DB STATUS API
// ----------------------------------------------------
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        dbType: db.getDBType(),
        message: db.getDBType() === 'MSSQL' 
            ? 'Connected to Microsoft SQL Server (SSMS)' 
            : 'Using Embedded Local Database (SQLite)'
    });
});

// ----------------------------------------------------
// AUTHENTICATION ROUTES (Login, Signup, User setup)
// ----------------------------------------------------

app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
            return res.status(400).json({ success: false, message: 'Username and password are required.' });
        }

        const user = await db.queryOne('SELECT * FROM Users WHERE username = @username', { username });

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ success: false, message: 'Invalid username or password.' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, fullName: user.full_name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: 'Login successful!',
            token,
            user: {
                id: user.id,
                username: user.username,
                fullName: user.full_name,
                role: user.role
            }
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Internal server error during login.' });
    }
});

app.post('/api/auth/register', loginLimiter, async (req, res) => {
    try {
        let { username, password, fullName, role } = req.body;

        if (!username || !password || !fullName) {
            return res.status(400).json({ success: false, message: 'All fields (Username, Password, Full Name) are required.' });
        }

        username = String(username).trim();
        fullName = String(fullName).trim();

        if (username.length < 3 || username.length > 30) {
            return res.status(400).json({ success: false, message: 'Username must be between 3 and 30 characters.' });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long for security.' });
        }

        const existing = await db.queryOne('SELECT id FROM Users WHERE username = @username', { username });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Username is already taken. Please choose another.' });
        }

        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);
        const userRole = role === 'Admin' ? 'Admin' : 'Active User';

        await db.executeRun(
            'INSERT INTO Users (username, password_hash, full_name, role) VALUES (@username, @password_hash, @fullName, @role)',
            { username, password_hash, fullName, role: userRole }
        );

        res.json({ success: true, message: 'Account created successfully! You can now log in.' });

    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Error creating user account: ' + err.message });
    }
});

app.post('/api/auth/update-profile', authenticateToken, async (req, res) => {
    try {
        const { fullName, currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        const user = await db.queryOne('SELECT * FROM Users WHERE id = @id', { id: userId });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        let newHash = user.password_hash;
        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({ success: false, message: 'Current password is required to set a new password.' });
            }
            const valid = await bcrypt.compare(currentPassword, user.password_hash);
            if (!valid) {
                return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
            }
            newHash = await bcrypt.hash(newPassword, 10);
        }

        const updatedName = fullName || user.full_name;

        await db.executeRun(
            'UPDATE Users SET full_name = @fullName, password_hash = @password_hash WHERE id = @id',
            { fullName: updatedName, password_hash: newHash, id: userId }
        );

        res.json({ success: true, message: 'Profile updated successfully!', fullName: updatedName });

    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ success: false, message: 'Error updating profile.' });
    }
});

// ----------------------------------------------------
// DASHBOARD METRICS API
// ----------------------------------------------------
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        const products = await db.queryAll('SELECT * FROM Products');
        const orders = await db.queryAll('SELECT * FROM Orders');

        let totalStockUnits = 0;
        let lowStockCount = 0;
        products.forEach(p => {
            totalStockUnits += (p.stock_quantity || 0);
            if ((p.stock_quantity || 0) <= (p.min_stock_alert || 5)) {
                lowStockCount++;
            }
        });

        let totalSalesPaid = 0;
        let marketPendingUdhaar = 0;

        orders.forEach(o => {
            const amount = parseFloat(o.net_amount || 0);
            const status = (o.payment_status || 'Paid').toLowerCase();
            if (status.includes('udhaar') || status.includes('pending') || status.includes('credit')) {
                marketPendingUdhaar += amount;
            } else {
                totalSalesPaid += amount;
            }
        });

        const formattedRecent = db.getDBType() === 'MSSQL' 
            ? await db.queryAll('SELECT TOP 5 * FROM Orders ORDER BY created_at DESC')
            : await db.queryAll('SELECT * FROM Orders ORDER BY created_at DESC LIMIT 5');

        res.json({
            success: true,
            stats: {
                totalProducts: products.length,
                totalStockUnits,
                lowStockCount,
                totalOrders: orders.length,
                totalSalesPaid,
                marketPendingUdhaar,
                dbType: db.getDBType()
            },
            recentOrders: formattedRecent
        });

    } catch (err) {
        console.error('Dashboard stats error:', err);
        res.status(500).json({ success: false, message: 'Error fetching dashboard stats.' });
    }
});

// ----------------------------------------------------
// INVENTORY & STOCK MANAGEMENT API
// ----------------------------------------------------
app.get('/api/products', authenticateToken, async (req, res) => {
    try {
        const products = await db.queryAll('SELECT * FROM Products ORDER BY id DESC');
        res.json({ success: true, products });
    } catch (err) {
        console.error('Get products error:', err);
        res.status(500).json({ success: false, message: 'Error retrieving products.' });
    }
});

app.post('/api/products', authenticateToken, async (req, res) => {
    try {
        const { sku, name, category, price, costPrice, stockQuantity, minStockAlert } = req.body;

        const sanitizedName = String(name || '').trim();
        const numPrice = parseFloat(price);

        if (!sanitizedName || isNaN(numPrice) || numPrice < 0) {
            return res.status(400).json({ success: false, message: 'Valid Product Name and non-negative Price are required.' });
        }

        const generatedSku = sku || 'PRD-' + Date.now().toString().slice(-6);
        const initialStock = Math.max(0, parseInt(stockQuantity) || 0);

        await db.executeRun(
            `INSERT INTO Products (sku, name, category, price, cost_price, stock_quantity, min_stock_alert) 
             VALUES (@sku, @name, @category, @price, @cost_price, @stock_quantity, @min_stock_alert)`,
            {
                sku: generatedSku,
                name: sanitizedName,
                category: String(category || 'Products').trim(),
                price: numPrice,
                cost_price: Math.max(0, parseFloat(costPrice) || 0),
                stock_quantity: initialStock,
                min_stock_alert: Math.max(1, parseInt(minStockAlert) || 5)
            }
        );

        const inserted = await db.queryOne('SELECT id FROM Products WHERE name = @name ORDER BY id DESC', { name });
        if (inserted && initialStock > 0) {
            await db.executeRun(
                `INSERT INTO StockHistory (product_id, product_name, quantity_change, change_type, notes)
                 VALUES (@product_id, @product_name, @quantity_change, 'Initial Stock', 'Added new product to inventory')`,
                { product_id: inserted.id, product_name: name, quantity_change: initialStock }
            );
        }

        res.json({ success: true, message: 'Product added to inventory successfully!' });

    } catch (err) {
        console.error('Add product error:', err);
        res.status(500).json({ success: false, message: 'Error adding product: ' + err.message });
    }
});

app.put('/api/products/:id', authenticateToken, async (req, res) => {
    try {
        const productId = req.params.id;
        const { name, category, price, costPrice, stockQuantity, minStockAlert } = req.body;

        const currentProd = await db.queryOne('SELECT name, stock_quantity FROM Products WHERE id = @id', { id: productId });
        const oldStock = currentProd ? (currentProd.stock_quantity || 0) : 0;
        const newStock = parseInt(stockQuantity) || 0;
        const stockDiff = newStock - oldStock;

        await db.executeRun(
            `UPDATE Products 
             SET name = @name, category = @category, price = @price, cost_price = @cost_price, stock_quantity = @stock_quantity, min_stock_alert = @min_stock_alert 
             WHERE id = @id`,
            {
                id: productId,
                name,
                category: category || 'Products',
                price: parseFloat(price) || 0,
                cost_price: parseFloat(costPrice) || 0,
                stock_quantity: newStock,
                min_stock_alert: parseInt(minStockAlert) || 5
            }
        );

        if (stockDiff !== 0) {
            await db.executeRun(
                `INSERT INTO StockHistory (product_id, product_name, quantity_change, change_type, notes)
                 VALUES (@product_id, @product_name, @quantity_change, 'Edit Adjustment', 'Stock modified via product edit')`,
                { product_id: productId, product_name: name, quantity_change: stockDiff }
            );
        }

        res.json({ success: true, message: 'Product updated successfully!' });

    } catch (err) {
        console.error('Update product error:', err);
        res.status(500).json({ success: false, message: 'Error updating product.' });
    }
});

app.put('/api/products/:id/stock', authenticateToken, async (req, res) => {
    try {
        const productId = req.params.id;
        const { adjustmentQuantity, notes } = req.body;

        const product = await db.queryOne('SELECT name, stock_quantity FROM Products WHERE id = @id', { id: productId });
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        const qtyDelta = parseInt(adjustmentQuantity) || 0;
        const newStock = Math.max(0, (product.stock_quantity || 0) + qtyDelta);

        await db.executeRun(
            'UPDATE Products SET stock_quantity = @stock WHERE id = @id',
            { stock: newStock, id: productId }
        );

        await db.executeRun(
            `INSERT INTO StockHistory (product_id, product_name, quantity_change, change_type, notes)
             VALUES (@product_id, @product_name, @quantity_change, @change_type, @notes)`,
            {
                product_id: productId,
                product_name: product.name,
                quantity_change: qtyDelta,
                change_type: qtyDelta >= 0 ? 'Restock' : 'Stock Deduction',
                notes: notes || (qtyDelta >= 0 ? 'Manual Stock Restock' : 'Manual Stock Adjustment')
            }
        );

        res.json({ success: true, message: 'Stock quantity updated!', newStock });

    } catch (err) {
        console.error('Adjust stock error:', err);
        res.status(500).json({ success: false, message: 'Error adjusting stock.' });
    }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
    try {
        const productId = req.params.id;
        await db.executeRun('DELETE FROM Products WHERE id = @id', { id: productId });
        res.json({ success: true, message: 'Product removed from inventory.' });
    } catch (err) {
        console.error('Delete product error:', err);
        res.status(500).json({ success: false, message: 'Error deleting product.' });
    }
});

// ----------------------------------------------------
// ORDERS & SALES MANAGEMENT API
// ----------------------------------------------------

app.post('/api/orders', authenticateToken, async (req, res) => {
    try {
        const { customerName, customerPhone, customerEmail, deliveryAddress, items, discount, paymentMethod, paymentStatus, includeGst } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Order must contain at least one item.' });
        }

        for (const item of items) {
            if (item.productId && item.productId > 0) {
                const prod = await db.queryOne('SELECT name, stock_quantity FROM Products WHERE id = @id', { id: item.productId });
                if (prod && prod.stock_quantity < item.quantity) {
                    return res.status(400).json({ 
                        success: false, 
                        message: `Insufficient stock for "${prod.name}". Available: ${prod.stock_quantity}, Requested: ${item.quantity}` 
                    });
                }
            }
        }

        let totalSubtotal = 0;
        items.forEach(item => {
            totalSubtotal += (item.unitPrice * item.quantity);
        });

        const gstRate = 18.00;
        const taxAmount = includeGst ? (totalSubtotal * (gstRate / 100)) : 0.00;
        const discountVal = parseFloat(discount) || 0;
        const netAmount = Math.max(0, totalSubtotal + taxAmount - discountVal);
        const orderNumber = 'ORD-' + Date.now().toString().slice(-8);
        const status = paymentStatus || 'Paid';

        await db.executeRun(
            `INSERT INTO Orders (order_number, customer_name, customer_phone, customer_email, delivery_address, total_amount, tax_amount, gst_rate, discount, net_amount, payment_method, payment_status)
             VALUES (@order_number, @customer_name, @customer_phone, @customer_email, @delivery_address, @total_amount, @tax_amount, @gst_rate, @discount, @net_amount, @payment_method, @payment_status)`,
            {
                order_number: orderNumber,
                customer_name: customerName || 'Walk-in Customer',
                customer_phone: customerPhone || '',
                customer_email: customerEmail || '',
                delivery_address: deliveryAddress || '',
                total_amount: totalSubtotal,
                tax_amount: taxAmount,
                gst_rate: gstRate,
                discount: discountVal,
                net_amount: netAmount,
                payment_method: paymentMethod || 'Cash',
                payment_status: status
            }
        );

        const createdOrder = await db.queryOne('SELECT id FROM Orders WHERE order_number = @order_number', { order_number: orderNumber });
        const orderId = createdOrder ? createdOrder.id : null;

        const statusTag = (status.toLowerCase().includes('udhaar') || status.toLowerCase().includes('credit')) ? 'Credit' : 'Paid';

        for (const item of items) {
            const subtotal = item.unitPrice * item.quantity;
            await db.executeRun(
                `INSERT INTO OrderItems (order_id, product_id, product_name, quantity, unit_price, subtotal)
                 VALUES (@order_id, @product_id, @product_name, @quantity, @unit_price, @subtotal)`,
                {
                    order_id: orderId,
                    product_id: item.productId || 0,
                    product_name: item.productName,
                    quantity: item.quantity,
                    unit_price: item.unitPrice,
                    subtotal: subtotal
                }
            );

            if (item.productId && item.productId > 0) {
                await db.executeRun(
                    'UPDATE Products SET stock_quantity = stock_quantity - @qty WHERE id = @id',
                    { qty: item.quantity, id: item.productId }
                );

                await db.executeRun(
                    `INSERT INTO StockHistory (product_id, product_name, quantity_change, change_type, notes)
                     VALUES (@product_id, @product_name, @quantity_change, 'Sale Deduction', @notes)`,
                    {
                        product_id: item.productId,
                        product_name: item.productName,
                        quantity_change: -item.quantity,
                        notes: `Order #${orderNumber} (${statusTag})`
                    }
                );
            }
        }

        res.json({
            success: true,
            message: 'Order created and saved successfully!',
            order: {
                id: orderId,
                orderNumber,
                totalAmount: totalSubtotal,
                taxAmount,
                gstRate,
                discount: discountVal,
                netAmount,
                customerName: customerName || 'Walk-in Customer',
                customerPhone,
                customerEmail,
                deliveryAddress,
                paymentStatus: status,
                createdAt: new Date()
            }
        });

    } catch (err) {
        console.error('Create order error:', err);
        res.status(500).json({ success: false, message: 'Error processing sale: ' + err.message });
    }
});

app.put('/api/orders/:id/status', authenticateToken, async (req, res) => {
    try {
        const orderId = req.params.id;
        const { paymentStatus } = req.body;

        await db.executeRun(
            'UPDATE Orders SET payment_status = @status WHERE id = @id',
            { status: paymentStatus || 'Paid', id: orderId }
        );

        res.json({ success: true, message: `Payment status updated to ${paymentStatus}!` });

    } catch (err) {
        console.error('Update payment status error:', err);
        res.status(500).json({ success: false, message: 'Error updating payment status.' });
    }
});

app.delete('/api/orders/:id', authenticateToken, async (req, res) => {
    try {
        const orderId = req.params.id;

        const items = await db.queryAll('SELECT product_id, product_name, quantity FROM OrderItems WHERE order_id = @id', { id: orderId });
        for (const item of items) {
            if (item.product_id && item.product_id > 0) {
                await db.executeRun('UPDATE Products SET stock_quantity = stock_quantity + @qty WHERE id = @id', { qty: item.quantity, id: item.product_id });
                await db.executeRun(
                    `INSERT INTO StockHistory (product_id, product_name, quantity_change, change_type, notes)
                     VALUES (@product_id, @product_name, @quantity_change, 'Order Deleted', 'Restored stock on order deletion')`,
                    { product_id: item.product_id, product_name: item.product_name, quantity_change: item.quantity }
                );
            }
        }

        await db.executeRun('DELETE FROM OrderItems WHERE order_id = @id', { id: orderId });
        await db.executeRun('DELETE FROM Orders WHERE id = @id', { id: orderId });

        res.json({ success: true, message: 'Order deleted successfully!' });

    } catch (err) {
        console.error('Delete order error:', err);
        res.status(500).json({ success: false, message: 'Error deleting order: ' + err.message });
    }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const orders = await db.queryAll('SELECT * FROM Orders ORDER BY id DESC');
        
        for (const order of orders) {
            const items = await db.queryAll('SELECT product_name, quantity, unit_price FROM OrderItems WHERE order_id = @order_id', { order_id: order.id });
            order.items = items;
            if (items && items.length > 0) {
                order.product_name = items.map(i => i.product_name).join(', ');
                order.item_quantity = items.reduce((acc, curr) => acc + curr.quantity, 0);
                order.item_price = items[0].unit_price;
            } else {
                order.product_name = 'Order Item';
                order.item_quantity = 1;
                order.item_price = order.net_amount;
            }
        }

        res.json({ success: true, orders });
    } catch (err) {
        console.error('Get order history error:', err);
        res.status(500).json({ success: false, message: 'Error fetching order history.' });
    }
});

app.get('/api/orders/:id', authenticateToken, async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await db.queryOne('SELECT * FROM Orders WHERE id = @id', { id: orderId });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const items = await db.queryAll('SELECT * FROM OrderItems WHERE order_id = @order_id', { order_id: orderId });

        res.json({
            success: true,
            order,
            items
        });

    } catch (err) {
        console.error('Get order details error:', err);
        res.status(500).json({ success: false, message: 'Error fetching order details.' });
    }
});

// ----------------------------------------------------
// STOCK HISTORY AUDIT LOG API (Includes DELETE endpoint)
// ----------------------------------------------------
app.get('/api/stock-history', authenticateToken, async (req, res) => {
    try {
        const history = await db.queryAll('SELECT * FROM StockHistory ORDER BY id DESC');
        res.json({ success: true, history });
    } catch (err) {
        console.error('Get stock history error:', err);
        res.status(500).json({ success: false, message: 'Error fetching stock audit log.' });
    }
});

app.delete('/api/stock-history/:id', authenticateToken, async (req, res) => {
    try {
        const logId = req.params.id;
        await db.executeRun('DELETE FROM StockHistory WHERE id = @id', { id: logId });
        res.json({ success: true, message: 'Stock history log entry deleted successfully!' });
    } catch (err) {
        console.error('Delete stock history error:', err);
        res.status(500).json({ success: false, message: 'Error deleting stock history entry.' });
    }
});

// Fallback single page application
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
db.initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Sensometric Specialities App is running at http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
});
