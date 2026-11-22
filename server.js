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
const isProduction = process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true';
const JWT_SECRET = process.env.JWT_SECRET || (
    isProduction ? null : 'sales_inventory_secret_key_2026'
);

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET must be configured for production.');
}

if (process.env.NETLIFY) {
    app.set('trust proxy', 1);
}

// Security Headers via Helmet
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
                scriptSrcAttr: ["'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
                imgSrc: ["'self'", "data:", "blob:"],
                connectSrc: ["'self'"],
            },
        },
        crossOriginEmbedderPolicy: false,
    })
);

// General Rate Limiter (High limit for local application)
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', generalLimiter);

// Login Protection
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 20 : 500,
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
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

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
            { expiresIn: '30d' }
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
        let { username, password, fullName, gmail } = req.body;

        if (typeof username !== 'string' || typeof password !== 'string' ||
            typeof fullName !== 'string' || typeof gmail !== 'string' ||
            !username.trim() || !password || !fullName.trim() || !gmail.trim()) {
            return res.status(400).json({ success: false, message: 'Full name, Gmail address, username, and password are required.' });
        }

        username = String(username).trim();
        fullName = String(fullName).trim();
        gmail = gmail.trim().toLowerCase();

        if (gmail.length > 254 || !/^[^\s@]+@gmail\.com$/.test(gmail)) {
            return res.status(400).json({ success: false, message: 'Please enter a valid @gmail.com address.' });
        }

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

        const existingGmail = await db.queryOne('SELECT id FROM Users WHERE LOWER(gmail) = @gmail', { gmail });
        if (existingGmail) {
            return res.status(400).json({ success: false, message: 'This Gmail address is already associated with an account.' });
        }

        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);
        await db.executeRun(
            'INSERT INTO Users (username, gmail, password_hash, full_name, role) VALUES (@username, @gmail, @password_hash, @fullName, @role)',
            { username, gmail, password_hash, fullName, role: 'Active User' }
        );

        res.json({ success: true, message: 'Account created successfully! You can now log in.' });

    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Error creating user account.' });
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
        const userId = req.user.id;
        const products = await db.queryAll('SELECT * FROM Products WHERE user_id = @userId', { userId });
        const orders = await db.queryAll('SELECT * FROM Orders WHERE user_id = @userId', { userId });

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
            ? await db.queryAll('SELECT TOP 5 * FROM Orders WHERE user_id = @userId ORDER BY created_at DESC', { userId })
            : await db.queryAll('SELECT * FROM Orders WHERE user_id = @userId ORDER BY created_at DESC LIMIT 5', { userId });

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
        const userId = req.user.id;
        const products = await db.queryAll('SELECT * FROM Products WHERE user_id = @userId ORDER BY id DESC', { userId });
        res.json({ success: true, products });
    } catch (err) {
        console.error('Get products error:', err);
        res.status(500).json({ success: false, message: 'Error retrieving products.' });
    }
});

app.post('/api/products', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { sku, name, category, price, costPrice, stockQuantity, minStockAlert } = req.body;

        const sanitizedName = String(name || '').trim();
        const numPrice = parseFloat(price);
        const costPriceProvided = costPrice !== '' && costPrice !== null && costPrice !== undefined;
        const numCostPrice = costPriceProvided ? Number(costPrice) : 0;
        const initialStock = Math.max(0, parseInt(stockQuantity, 10) || 0);

        if (initialStock > 0 && !costPriceProvided) {
            return res.status(400).json({ success: false, message: 'Enter the purchase cost per unit for the opening stock.' });
        }

        if (!sanitizedName || !Number.isFinite(numPrice) || numPrice < 0 ||
            !Number.isFinite(numCostPrice) || numCostPrice < 0) {
            return res.status(400).json({ success: false, message: 'Valid Product Name and non-negative Price are required.' });
        }

        const generatedSku = sku ? String(sku).trim() : 'PRD-' + Date.now().toString().slice(-6);

        // Check if SKU already exists for THIS user
        const existingSku = await db.queryOne('SELECT id FROM Products WHERE sku = @sku AND user_id = @userId', { sku: generatedSku, userId });
        if (existingSku) {
            return res.status(400).json({ success: false, message: `Product with SKU "${generatedSku}" already exists in your inventory.` });
        }

        await db.executeRun(
            `INSERT INTO Products (user_id, sku, name, category, price, cost_price, stock_quantity, min_stock_alert) 
             VALUES (@userId, @sku, @name, @category, @price, @cost_price, @stock_quantity, @min_stock_alert)`,
            {
                userId,
                sku: generatedSku,
                name: sanitizedName,
                category: String(category || 'Products').trim(),
                price: numPrice,
                cost_price: numCostPrice,
                stock_quantity: initialStock,
                min_stock_alert: Math.max(1, parseInt(minStockAlert) || 5)
            }
        );

        const inserted = await db.queryOne('SELECT id FROM Products WHERE name = @name AND user_id = @userId ORDER BY id DESC', { name: sanitizedName, userId });
        if (inserted && initialStock > 0) {
            await db.executeRun(
                `INSERT INTO StockHistory (user_id, product_id, product_name, quantity_change, change_type, notes, purchase_unit_cost, purchase_total)
                 VALUES (@userId, @product_id, @product_name, @quantity_change, 'Initial Stock', 'Added new product to inventory', @purchase_unit_cost, @purchase_total)`,
                {
                    userId,
                    product_id: inserted.id,
                    product_name: sanitizedName,
                    quantity_change: initialStock,
                    purchase_unit_cost: numCostPrice,
                    purchase_total: initialStock * numCostPrice
                }
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
        const userId = req.user.id;
        const { name, category, price, costPrice, stockQuantity, minStockAlert } = req.body;

        const currentProd = await db.queryOne('SELECT name, stock_quantity FROM Products WHERE id = @id AND user_id = @userId', { id: productId, userId });
        if (!currentProd) {
            return res.status(404).json({ success: false, message: 'Product not found or access denied.' });
        }

        const oldStock = currentProd ? (currentProd.stock_quantity || 0) : 0;
        const newStock = parseInt(stockQuantity) || 0;
        const stockDiff = newStock - oldStock;

        await db.executeRun(
            `UPDATE Products 
             SET name = @name, category = @category, price = @price, cost_price = @cost_price, stock_quantity = @stock_quantity, min_stock_alert = @min_stock_alert 
             WHERE id = @id AND user_id = @userId`,
            {
                id: productId,
                userId,
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
                `INSERT INTO StockHistory (user_id, product_id, product_name, quantity_change, change_type, notes)
                 VALUES (@userId, @product_id, @product_name, @quantity_change, 'Edit Adjustment', 'Stock modified via product edit')`,
                { userId, product_id: productId, product_name: name, quantity_change: stockDiff }
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
        const userId = req.user.id;
        const { adjustmentQuantity, purchaseUnitCost, notes } = req.body;

        const product = await db.queryOne('SELECT name, stock_quantity FROM Products WHERE id = @id AND user_id = @userId', { id: productId, userId });
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found or access denied.' });
        }

        const qtyDelta = Number(adjustmentQuantity);
        if (!Number.isInteger(qtyDelta) || qtyDelta === 0) {
            return res.status(400).json({ success: false, message: 'Enter a non-zero whole number for the stock change.' });
        }

        const unitCost = purchaseUnitCost === '' || purchaseUnitCost === null || purchaseUnitCost === undefined
            ? NaN
            : Number(purchaseUnitCost);
        if (qtyDelta > 0 && (!Number.isFinite(unitCost) || unitCost < 0)) {
            return res.status(400).json({ success: false, message: 'Enter a valid non-negative purchase cost per unit for incoming stock.' });
        }

        const newStock = Math.max(0, (product.stock_quantity || 0) + qtyDelta);

        await db.executeRun(
            'UPDATE Products SET stock_quantity = @stock WHERE id = @id AND user_id = @userId',
            { stock: newStock, id: productId, userId }
        );

        await db.executeRun(
            `INSERT INTO StockHistory (user_id, product_id, product_name, quantity_change, change_type, notes, purchase_unit_cost, purchase_total)
             VALUES (@userId, @product_id, @product_name, @quantity_change, @change_type, @notes, @purchase_unit_cost, @purchase_total)`,
            {
                userId,
                product_id: productId,
                product_name: product.name,
                quantity_change: qtyDelta,
                change_type: qtyDelta >= 0 ? 'Restock' : 'Stock Deduction',
                notes: notes || (qtyDelta >= 0 ? 'Manual Stock Restock' : 'Manual Stock Adjustment'),
                purchase_unit_cost: qtyDelta > 0 ? unitCost : null,
                purchase_total: qtyDelta > 0 ? qtyDelta * unitCost : null
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
        const userId = req.user.id;

        const existing = await db.queryOne('SELECT id FROM Products WHERE id = @id AND user_id = @userId', { id: productId, userId });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Product not found or access denied.' });
        }

        // Clean up any StockHistory referencing this product for this user
        await db.executeRun('DELETE FROM StockHistory WHERE product_id = @id AND user_id = @userId', { id: productId, userId });
        // Dissociate OrderItems so existing invoices remain viewable
        await db.executeRun('UPDATE OrderItems SET product_id = 0 WHERE product_id = @id', { id: productId });
        // Remove product
        await db.executeRun('DELETE FROM Products WHERE id = @id AND user_id = @userId', { id: productId, userId });
        res.json({ success: true, message: 'Product removed from inventory successfully!' });
    } catch (err) {
        console.error('Delete product error:', err);
        res.status(500).json({ success: false, message: 'Error deleting product: ' + err.message });
    }
});

// ----------------------------------------------------
// ORDERS & SALES MANAGEMENT API
// ----------------------------------------------------

app.post('/api/orders', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { customerName, customerPhone, customerEmail, deliveryAddress, items, discount, paymentMethod, paymentStatus, includeGst } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Order must contain at least one item.' });
        }

        for (const item of items) {
            if (item.productId && item.productId > 0) {
                const prod = await db.queryOne('SELECT name, stock_quantity FROM Products WHERE id = @id AND user_id = @userId', { id: item.productId, userId });
                if (!prod) {
                    return res.status(400).json({ 
                        success: false, 
                        message: `Product "${item.productName || item.productId}" not found in your inventory.` 
                    });
                }
                if (prod.stock_quantity < item.quantity) {
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
            `INSERT INTO Orders (user_id, order_number, customer_name, customer_phone, customer_email, delivery_address, total_amount, tax_amount, gst_rate, discount, net_amount, payment_method, payment_status)
             VALUES (@userId, @order_number, @customer_name, @customer_phone, @customer_email, @delivery_address, @total_amount, @tax_amount, @gst_rate, @discount, @net_amount, @payment_method, @payment_status)`,
            {
                userId,
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

        const createdOrder = await db.queryOne('SELECT id FROM Orders WHERE order_number = @order_number AND user_id = @userId', { order_number: orderNumber, userId });
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
                    'UPDATE Products SET stock_quantity = stock_quantity - @qty WHERE id = @id AND user_id = @userId',
                    { qty: item.quantity, id: item.productId, userId }
                );

                await db.executeRun(
                    `INSERT INTO StockHistory (user_id, product_id, product_name, quantity_change, change_type, notes)
                     VALUES (@userId, @product_id, @product_name, @quantity_change, 'Sale Deduction', @notes)`,
                    {
                        userId,
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
        const userId = req.user.id;
        const { paymentStatus } = req.body;

        const existingOrder = await db.queryOne('SELECT id FROM Orders WHERE id = @id AND user_id = @userId', { id: orderId, userId });
        if (!existingOrder) {
            return res.status(404).json({ success: false, message: 'Order not found or access denied.' });
        }

        await db.executeRun(
            'UPDATE Orders SET payment_status = @status WHERE id = @id AND user_id = @userId',
            { status: paymentStatus || 'Paid', id: orderId, userId }
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
        const userId = req.user.id;

        const existingOrder = await db.queryOne('SELECT id FROM Orders WHERE id = @id AND user_id = @userId', { id: orderId, userId });
        if (!existingOrder) {
            return res.status(404).json({ success: false, message: 'Order not found or access denied.' });
        }

        const items = await db.queryAll('SELECT product_id, product_name, quantity FROM OrderItems WHERE order_id = @id', { id: orderId });
        for (const item of items) {
            if (item.product_id && item.product_id > 0) {
                await db.executeRun('UPDATE Products SET stock_quantity = stock_quantity + @qty WHERE id = @id AND user_id = @userId', { qty: item.quantity, id: item.product_id, userId });
                await db.executeRun(
                    `INSERT INTO StockHistory (user_id, product_id, product_name, quantity_change, change_type, notes)
                     VALUES (@userId, @product_id, @product_name, @quantity_change, 'Order Deleted', 'Restored stock on order deletion')`,
                    { userId, product_id: item.product_id, product_name: item.product_name, quantity_change: item.quantity }
                );
            }
        }

        await db.executeRun('DELETE FROM OrderItems WHERE order_id = @id', { id: orderId });
        await db.executeRun('DELETE FROM Orders WHERE id = @id AND user_id = @userId', { id: orderId, userId });

        res.json({ success: true, message: 'Order deleted successfully!' });

    } catch (err) {
        console.error('Delete order error:', err);
        res.status(500).json({ success: false, message: 'Error deleting order: ' + err.message });
    }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const orders = await db.queryAll('SELECT * FROM Orders WHERE user_id = @userId ORDER BY id DESC', { userId });
        
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
        const userId = req.user.id;
        const order = await db.queryOne('SELECT * FROM Orders WHERE id = @id AND user_id = @userId', { id: orderId, userId });

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

app.get('/api/reports/monthly-audit', authenticateToken, async (req, res) => {
    try {
        const month = req.query.month;
        if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            return res.status(400).json({ success: false, message: 'Choose a valid month for the audit report.' });
        }

        const [year, monthNumber] = month.split('-').map(Number);
        const startDate = `${month}-01`;
        const endDate = monthNumber === 12
            ? `${year + 1}-01-01`
            : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
        const userId = req.user.id;

        const orders = await db.queryAll(
            `SELECT id, order_number, customer_name, payment_status, total_amount, tax_amount, net_amount, created_at
             FROM Orders
             WHERE user_id = @userId AND created_at >= @startDate AND created_at < @endDate
             ORDER BY created_at, id`,
            { userId, startDate, endDate }
        );
        const orderItems = await db.queryAll(
            `SELECT oi.order_id, oi.product_name, oi.quantity, oi.unit_price, oi.subtotal
             FROM OrderItems oi
             INNER JOIN Orders o ON o.id = oi.order_id
             WHERE o.user_id = @userId AND o.created_at >= @startDate AND o.created_at < @endDate`,
            { userId, startDate, endDate }
        );
        const stockHistory = await db.queryAll(
            `SELECT id, product_name, quantity_change, change_type, notes,
                    purchase_unit_cost, purchase_total, created_at
             FROM StockHistory
             WHERE user_id = @userId AND created_at >= @startDate AND created_at < @endDate
             ORDER BY created_at, id`,
            { userId, startDate, endDate }
        );

        const itemsByOrder = new Map();
        orderItems.forEach(item => {
            const orderId = String(item.order_id);
            const items = itemsByOrder.get(orderId) || [];
            items.push(item);
            itemsByOrder.set(orderId, items);
        });

        const sales = orders.map(order => {
            const items = itemsByOrder.get(String(order.id)) || [];
            return {
                ...order,
                items,
                gstApplied: Number(order.tax_amount || 0) > 0,
                itemCount: items.reduce((total, item) => total + Number(item.quantity || 0), 0)
            };
        });

        const totalSales = sales.reduce((total, order) => total + Number(order.net_amount || 0), 0);
        const gstSales = sales.filter(order => order.gstApplied);
        const nonGstSales = sales.filter(order => !order.gstApplied);
        const salesWithGst = gstSales.reduce((total, order) => total + Number(order.net_amount || 0), 0);
        const salesWithoutGst = nonGstSales.reduce((total, order) => total + Number(order.net_amount || 0), 0);
        const gstCollected = gstSales.reduce((total, order) => total + Number(order.tax_amount || 0), 0);
        const paidSales = sales.reduce((total, order) => {
            const status = String(order.payment_status || 'Paid').toLowerCase();
            return total + (status.includes('udhaar') || status.includes('credit') || status.includes('pending')
                ? 0
                : Number(order.net_amount || 0));
        }, 0);
        const creditSales = totalSales - paidSales;
        const totalItemsSold = sales.reduce((total, order) => total + order.itemCount, 0);

        const stockPurchases = stockHistory.filter(entry =>
            Number(entry.quantity_change) > 0 &&
            (String(entry.change_type).toLowerCase().includes('restock') ||
                String(entry.change_type).toLowerCase().includes('initial stock'))
        );
        const stockPurchaseQuantity = stockPurchases.reduce(
            (total, entry) => total + Number(entry.quantity_change),
            0
        );
        const stockPurchaseCost = stockPurchases.reduce(
            (total, entry) => total + (entry.purchase_total === null || entry.purchase_total === undefined
                ? 0
                : Number(entry.purchase_total)),
            0
        );
        const stockPurchaseQuantityWithoutCost = stockPurchases.reduce(
            (total, entry) => total + (entry.purchase_total === null || entry.purchase_total === undefined
                ? Number(entry.quantity_change)
                : 0),
            0
        );

        res.json({
            success: true,
            report: {
                month,
                summary: {
                    orderCount: sales.length,
                    totalSales,
                    gstSalesCount: gstSales.length,
                    salesWithGst,
                    nonGstSalesCount: nonGstSales.length,
                    salesWithoutGst,
                    gstCollected,
                    paidSales,
                    creditSales,
                    totalItemsSold,
                    stockPurchaseEntries: stockPurchases.length,
                    stockPurchaseQuantity,
                    stockPurchaseCost,
                    stockPurchaseQuantityWithoutCost
                },
                sales,
                stockPurchases
            }
        });
    } catch (err) {
        console.error('Monthly audit report error:', err);
        res.status(500).json({ success: false, message: 'Error generating the monthly audit report.' });
    }
});

// ----------------------------------------------------
// STOCK HISTORY AUDIT LOG API (Includes DELETE endpoint)
// ----------------------------------------------------
app.get('/api/stock-history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const history = await db.queryAll('SELECT * FROM StockHistory WHERE user_id = @userId ORDER BY id DESC', { userId });
        res.json({ success: true, history });
    } catch (err) {
        console.error('Get stock history error:', err);
        res.status(500).json({ success: false, message: 'Error fetching stock audit log.' });
    }
});

app.delete('/api/stock-history/:id', authenticateToken, async (req, res) => {
    try {
        const logId = req.params.id;
        const userId = req.user.id;
        await db.executeRun('DELETE FROM StockHistory WHERE id = @id AND user_id = @userId', { id: logId, userId });
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

let databaseInitialization;

function initializeDatabase() {
    if (!databaseInitialization) {
        databaseInitialization = db.initDB();
    }
    return databaseInitialization;
}

if (require.main === module) {
    initializeDatabase().then(() => {
        app.listen(PORT, () => {
            console.log(`Sensometric Specialities App is running at http://localhost:${PORT}`);
        });
    }).catch(err => {
        console.error('Failed to initialize database:', err);
        process.exitCode = 1;
    });
}

module.exports = { app, initializeDatabase };
