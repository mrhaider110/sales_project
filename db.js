const sql = require('mssql');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

let dbType = 'MSSQL'; // 'MSSQL' or 'SQLITE'
let mssqlPool = null;
let sqliteDb = null;

// Config for SSMS MS SQL Server
const sqlConfig = {
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || 'YourPassword123',
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_DATABASE || 'SalesInventoryDB',
    port: parseInt(process.env.DB_PORT) || 1433,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false'
    },
    connectionTimeout: 5000
};

// Initialize Database connection
async function initDB() {
    try {
        console.log('🔄 Attempting connection to SSMS (Microsoft SQL Server)...');
        mssqlPool = await new sql.ConnectionPool(sqlConfig).connect();
        dbType = 'MSSQL';
        console.log('✅ Successfully connected to Microsoft SQL Server (SSMS)!');
        await initMssqlTables();
    } catch (err) {
        console.warn('⚠️ Could not connect to SSMS MS SQL Server:', err.message);
        console.log('🔄 Falling back to Local Embedded Database (SQLite) for immediate demo...');
        dbType = 'SQLITE';
        await initSqliteDB();
    }
}

// SSMS Table Setup
async function initMssqlTables() {
    try {
        const request = mssqlPool.request();
        
        await request.query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
            BEGIN
                CREATE TABLE Users (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    username NVARCHAR(50) NOT NULL UNIQUE,
                    gmail NVARCHAR(254) NULL,
                    password_hash NVARCHAR(255) NOT NULL,
                    full_name NVARCHAR(100) NOT NULL,
                    role NVARCHAR(20) DEFAULT 'Admin',
                    created_at DATETIME DEFAULT GETDATE()
                );
            END;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Users') AND name = 'gmail')
            BEGIN
                ALTER TABLE Users ADD gmail NVARCHAR(254) NULL;
            END;

            IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('Users') AND name = 'UX_Users_gmail')
            BEGIN
                CREATE UNIQUE INDEX UX_Users_gmail ON Users(gmail) WHERE gmail IS NOT NULL;
            END;

            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
            BEGIN
                CREATE TABLE Products (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    user_id INT DEFAULT 1,
                    sku NVARCHAR(50) NOT NULL,
                    name NVARCHAR(150) NOT NULL,
                    category NVARCHAR(50) NOT NULL,
                    price DECIMAL(18, 2) NOT NULL,
                    cost_price DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
                    stock_quantity INT NOT NULL DEFAULT 0,
                    min_stock_alert INT NOT NULL DEFAULT 5,
                    created_at DATETIME DEFAULT GETDATE()
                );
            END;

            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
            BEGIN
                CREATE TABLE Orders (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    user_id INT DEFAULT 1,
                    order_number NVARCHAR(50) NOT NULL UNIQUE,
                    customer_name NVARCHAR(100) DEFAULT 'Walk-in Customer',
                    customer_phone NVARCHAR(20) DEFAULT '',
                    customer_email NVARCHAR(100) DEFAULT '',
                    delivery_address NVARCHAR(255) DEFAULT '',
                    total_amount DECIMAL(18, 2) NOT NULL,
                    tax_amount DECIMAL(18, 2) DEFAULT 0.00,
                    gst_rate DECIMAL(18, 2) DEFAULT 18.00,
                    discount DECIMAL(18, 2) DEFAULT 0.00,
                    net_amount DECIMAL(18, 2) NOT NULL,
                    payment_method NVARCHAR(50) DEFAULT 'Cash',
                    payment_status NVARCHAR(50) DEFAULT 'Paid',
                    created_at DATETIME DEFAULT GETDATE()
                );
            END;

            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderItems')
            BEGIN
                CREATE TABLE OrderItems (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    order_id INT NOT NULL,
                    product_id INT NOT NULL,
                    product_name NVARCHAR(150) NOT NULL,
                    quantity INT NOT NULL,
                    unit_price DECIMAL(18, 2) NOT NULL,
                    subtotal DECIMAL(18, 2) NOT NULL
                );
            END;

            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StockHistory')
            BEGIN
                CREATE TABLE StockHistory (
                    id INT IDENTITY(1,1) PRIMARY KEY,
                    user_id INT DEFAULT 1,
                    product_id INT NOT NULL,
                    product_name NVARCHAR(150) NOT NULL,
                    quantity_change INT NOT NULL,
                    change_type NVARCHAR(50) NOT NULL,
                    notes NVARCHAR(255) DEFAULT '',
                    created_at DATETIME DEFAULT GETDATE()
                );
            END;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Products') AND name = 'user_id')
            BEGIN
                ALTER TABLE Products ADD user_id INT DEFAULT 1;
            END;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Orders') AND name = 'user_id')
            BEGIN
                ALTER TABLE Orders ADD user_id INT DEFAULT 1;
            END;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('StockHistory') AND name = 'user_id')
            BEGIN
                ALTER TABLE StockHistory ADD user_id INT DEFAULT 1;
            END;
        `);

        // Check if admin user exists
        const userCheck = await mssqlPool.request().query("SELECT COUNT(*) as count FROM Users");
        if (userCheck.recordset[0].count === 0) {
            const hash = await bcrypt.hash('admin123', 10);
            const req = mssqlPool.request();
            req.input('username', sql.NVarChar, 'admin');
            req.input('password_hash', sql.NVarChar, hash);
            req.input('full_name', sql.NVarChar, 'System Administrator');
            await req.query("INSERT INTO Users (username, password_hash, full_name, role) VALUES (@username, @password_hash, @full_name, 'Admin')");
        }

        // Check if initial products exist
        const prodCheck = await mssqlPool.request().query("SELECT COUNT(*) as count FROM Products");
        if (prodCheck.recordset[0].count === 0) {
            await mssqlPool.request().query(`
                INSERT INTO Products (sku, name, category, price, cost_price, stock_quantity, min_stock_alert)
                VALUES 
                ('PRD-1001', 'Wireless Mouse', 'Electronics', 1500.00, 950.00, 45, 10),
                ('PRD-1002', 'Mechanical Keyboard', 'Electronics', 4500.00, 3200.00, 20, 5),
                ('PRD-1003', 'USB-C Charging Cable 2m', 'Accessories', 850.00, 400.00, 8, 10),
                ('PRD-1004', 'HD LED Monitor 24-inch', 'Electronics', 28500.00, 22000.00, 12, 3),
                ('PRD-1005', 'Ergonomic Desk Chair', 'Furniture', 18500.00, 13500.00, 4, 5);
            `);
        }

    } catch (e) {
        console.error('Error initializing SSMS tables:', e.message);
    }
}

// SQLite Local Fallback Setup
function initSqliteDB() {
    return new Promise((resolve, reject) => {
        const dbPath = path.join(__dirname, 'sales_inventory.db');
        sqliteDb = new sqlite3.Database(dbPath, async (err) => {
            if (err) return reject(err);
            console.log('✅ Connected to SQLite database:', dbPath);

            sqliteDb.serialize(async () => {
                sqliteDb.run(`CREATE TABLE IF NOT EXISTS Users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    gmail TEXT,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT DEFAULT 'Admin',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                sqliteDb.run(`CREATE TABLE IF NOT EXISTS Products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER DEFAULT 1,
                    sku TEXT NOT NULL,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL,
                    price REAL NOT NULL,
                    cost_price REAL DEFAULT 0.00,
                    stock_quantity INTEGER NOT NULL DEFAULT 0,
                    min_stock_alert INTEGER NOT NULL DEFAULT 5,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                sqliteDb.run(`CREATE TABLE IF NOT EXISTS Orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER DEFAULT 1,
                    order_number TEXT UNIQUE NOT NULL,
                    customer_name TEXT DEFAULT 'Walk-in Customer',
                    customer_phone TEXT DEFAULT '',
                    customer_email TEXT DEFAULT '',
                    delivery_address TEXT DEFAULT '',
                    total_amount REAL NOT NULL,
                    tax_amount REAL DEFAULT 0.00,
                    gst_rate REAL DEFAULT 18.00,
                    discount REAL DEFAULT 0.00,
                    net_amount REAL NOT NULL,
                    payment_method TEXT DEFAULT 'Cash',
                    payment_status TEXT DEFAULT 'Paid',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                sqliteDb.run(`CREATE TABLE IF NOT EXISTS OrderItems (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL,
                    product_id INTEGER NOT NULL,
                    product_name TEXT NOT NULL,
                    quantity INTEGER NOT NULL,
                    unit_price REAL NOT NULL,
                    subtotal INTEGER NOT NULL
                )`);

                sqliteDb.run(`CREATE TABLE IF NOT EXISTS StockHistory (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER DEFAULT 1,
                    product_id INTEGER NOT NULL,
                    product_name TEXT NOT NULL,
                    quantity_change INTEGER NOT NULL,
                    change_type TEXT NOT NULL,
                    notes TEXT DEFAULT '',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`);

                // Ensure columns exist on Orders and other tables if created previously
                sqliteDb.run("ALTER TABLE Products ADD COLUMN user_id INTEGER DEFAULT 1", () => {});
                sqliteDb.run("ALTER TABLE Orders ADD COLUMN user_id INTEGER DEFAULT 1", () => {});
                sqliteDb.run("ALTER TABLE StockHistory ADD COLUMN user_id INTEGER DEFAULT 1", () => {});
                sqliteDb.run("ALTER TABLE Orders ADD COLUMN tax_amount REAL DEFAULT 0.00", () => {});
                sqliteDb.run("ALTER TABLE Orders ADD COLUMN gst_rate REAL DEFAULT 18.00", () => {});
                sqliteDb.run("ALTER TABLE Orders ADD COLUMN payment_status TEXT DEFAULT 'Paid'", () => {});
                sqliteDb.run("ALTER TABLE Orders ADD COLUMN customer_email TEXT DEFAULT ''", () => {});
                sqliteDb.run("ALTER TABLE Orders ADD COLUMN delivery_address TEXT DEFAULT ''", () => {});

                sqliteDb.all("PRAGMA table_info(Users)", (err, columns) => {
                    if (err) {
                        console.error('Error checking Users table columns:', err.message);
                        return reject(err);
                    }

                    const hasGmailColumn = columns.some(column => column.name === 'gmail');
                    const createGmailIndex = () => {
                        sqliteDb.run(
                            'CREATE UNIQUE INDEX IF NOT EXISTS UX_Users_gmail ON Users(gmail) WHERE gmail IS NOT NULL',
                            (indexErr) => {
                                if (indexErr) {
                                    console.error('Error creating Gmail uniqueness index:', indexErr.message);
                                    return reject(indexErr);
                                }
                                resolve();
                            }
                        );
                    };

                    if (hasGmailColumn) {
                        createGmailIndex();
                    } else {
                        sqliteDb.run('ALTER TABLE Users ADD COLUMN gmail TEXT', (alterErr) => {
                            if (alterErr) {
                                console.error('Error adding Gmail column to Users table:', alterErr.message);
                                return reject(alterErr);
                            }
                            createGmailIndex();
                        });
                    }
                });

                // Check default admin user
                sqliteDb.get("SELECT COUNT(*) as count FROM Users", async (err, row) => {
                    if (row && row.count === 0) {
                        const hash = await bcrypt.hash('admin123', 10);
                        sqliteDb.run(
                            "INSERT INTO Users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)",
                            ['admin', hash, 'System Administrator', 'Admin']
                        );
                    }
                });

                // Check seed products for admin
                sqliteDb.get("SELECT COUNT(*) as count FROM Products WHERE user_id = 1", (err, row) => {
                    if (row && row.count === 0) {
                        const stmt = sqliteDb.prepare("INSERT INTO Products (user_id, sku, name, category, price, cost_price, stock_quantity, min_stock_alert) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
                        stmt.run([1, 'PRD-1001', 'Wireless Mouse', 'Electronics', 1500.00, 950.00, 45, 10]);
                        stmt.run([1, 'PRD-1002', 'Mechanical Keyboard', 'Electronics', 4500.00, 3200.00, 20, 5]);
                        stmt.run([1, 'PRD-1003', 'USB-C Charging Cable 2m', 'Accessories', 850.00, 400.00, 8, 10]);
                        stmt.run([1, 'PRD-1004', 'HD LED Monitor 24-inch', 'Electronics', 28500.00, 22000.00, 12, 3]);
                        stmt.run([1, 'PRD-1005', 'Ergonomic Desk Chair', 'Furniture', 18500.00, 13500.00, 4, 5]);
                        stmt.finalize();
                    }
                });

            });
        });
    });
}

// Unified Query Execution Helper
async function queryAll(sqlStr, params = {}) {
    if (dbType === 'MSSQL') {
        const req = mssqlPool.request();
        for (const [key, val] of Object.entries(params)) {
            req.input(key, val);
        }
        const res = await req.query(sqlStr);
        return res.recordset;
    } else {
        let sqlFormatted = sqlStr;
        const paramValues = [];
        for (const [key, val] of Object.entries(params)) {
            sqlFormatted = sqlFormatted.replace(new RegExp(`@${key}\\b`, 'g'), '?');
            paramValues.push(val);
        }

        return new Promise((resolve, reject) => {
            sqliteDb.all(sqlFormatted, paramValues, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    }
}

async function queryOne(sqlStr, params = {}) {
    const rows = await queryAll(sqlStr, params);
    return rows.length > 0 ? rows[0] : null;
}

async function executeRun(sqlStr, params = {}) {
    if (dbType === 'MSSQL') {
        const req = mssqlPool.request();
        for (const [key, val] of Object.entries(params)) {
            req.input(key, val);
        }
        const res = await req.query(sqlStr);
        return res;
    } else {
        let sqlFormatted = sqlStr;
        const paramValues = [];
        for (const [key, val] of Object.entries(params)) {
            sqlFormatted = sqlFormatted.replace(new RegExp(`@${key}\\b`, 'g'), '?');
            paramValues.push(val);
        }

        return new Promise((resolve, reject) => {
            sqliteDb.run(sqlFormatted, paramValues, function (err) {
                if (err) return reject(err);
                resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }
}

function getDBType() {
    return dbType;
}

module.exports = {
    initDB,
    queryAll,
    queryOne,
    executeRun,
    getDBType
};
