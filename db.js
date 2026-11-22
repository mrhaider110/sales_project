const sql = require('mssql');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true';
let dbType = 'MSSQL'; // 'MSSQL', 'SQLITE', or 'POSTGRES'
let mssqlPool = null;
let sqliteDb = null;
let postgresPool = null;

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

function getInitialAdminCredentials() {
    const username = process.env.INITIAL_ADMIN_USERNAME;
    const password = process.env.INITIAL_ADMIN_PASSWORD;

    if (username || password) {
        if (!username || !password) {
            throw new Error('Both INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD must be set together.');
        }
        return { username, password };
    }

    return isProduction
        ? null
        : { username: 'admin', password: 'admin123' };
}

// Initialize Database connection
async function initDB() {
    getInitialAdminCredentials();

    if (process.env.DATABASE_URL) {
        postgresPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: parseInt(process.env.PG_POOL_MAX, 10) || 1,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 10000
        });

        try {
            await postgresPool.query('SELECT 1');
            dbType = 'POSTGRES';
            await initPostgresTables();
            console.log('✅ Connected to PostgreSQL database.');
            return;
        } catch (err) {
            await postgresPool.end();
            postgresPool = null;
            throw err;
        }
    }

    if (isProduction) {
        throw new Error('DATABASE_URL must be configured for production.');
    }

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

async function initPostgresTables() {
    const statements = [
        `CREATE TABLE IF NOT EXISTS Users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) NOT NULL UNIQUE,
            gmail VARCHAR(254) UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(100) NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'Active User',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS Products (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL DEFAULT 1,
            sku VARCHAR(50) NOT NULL,
            name VARCHAR(150) NOT NULL,
            category VARCHAR(50) NOT NULL,
            price NUMERIC(18, 2) NOT NULL,
            cost_price NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
            stock_quantity INTEGER NOT NULL DEFAULT 0,
            min_stock_alert INTEGER NOT NULL DEFAULT 5,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS Orders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL DEFAULT 1,
            order_number VARCHAR(50) NOT NULL UNIQUE,
            customer_name VARCHAR(100) NOT NULL DEFAULT 'Walk-in Customer',
            customer_phone VARCHAR(20) NOT NULL DEFAULT '',
            customer_email VARCHAR(100) NOT NULL DEFAULT '',
            delivery_address VARCHAR(255) NOT NULL DEFAULT '',
            total_amount NUMERIC(18, 2) NOT NULL,
            tax_amount NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
            gst_rate NUMERIC(18, 2) NOT NULL DEFAULT 18.00,
            discount NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
            net_amount NUMERIC(18, 2) NOT NULL,
            payment_method VARCHAR(50) NOT NULL DEFAULT 'Cash',
            payment_status VARCHAR(50) NOT NULL DEFAULT 'Paid',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS OrderItems (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            product_name VARCHAR(150) NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price NUMERIC(18, 2) NOT NULL,
            subtotal NUMERIC(18, 2) NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS StockHistory (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL DEFAULT 1,
            product_id INTEGER NOT NULL,
            product_name VARCHAR(150) NOT NULL,
            quantity_change INTEGER NOT NULL,
            change_type VARCHAR(50) NOT NULL,
            notes VARCHAR(255) NOT NULL DEFAULT '',
            purchase_unit_cost NUMERIC(18, 2),
            purchase_total NUMERIC(18, 2),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`,
        'ALTER TABLE StockHistory ADD COLUMN IF NOT EXISTS purchase_unit_cost NUMERIC(18, 2)',
        'ALTER TABLE StockHistory ADD COLUMN IF NOT EXISTS purchase_total NUMERIC(18, 2)',
        'CREATE UNIQUE INDEX IF NOT EXISTS UX_Products_user_sku ON Products(user_id, sku)',
        'CREATE INDEX IF NOT EXISTS IX_Products_user_id ON Products(user_id)',
        'CREATE INDEX IF NOT EXISTS IX_Orders_user_id ON Orders(user_id)',
        'CREATE INDEX IF NOT EXISTS IX_StockHistory_user_id ON StockHistory(user_id)'
    ];

    for (const statement of statements) {
        await postgresPool.query(statement);
    }

    const userCount = await postgresPool.query('SELECT COUNT(*)::INTEGER AS count FROM Users');
    const adminCredentials = getInitialAdminCredentials();
    if (userCount.rows[0].count === 0 && adminCredentials) {
        const passwordHash = await bcrypt.hash(adminCredentials.password, 10);
        await postgresPool.query(
            "INSERT INTO Users (username, password_hash, full_name, role) VALUES ($1, $2, $3, 'Admin') ON CONFLICT (username) DO NOTHING",
            [adminCredentials.username, passwordHash, 'System Administrator']
        );
    }

    const productCount = await postgresPool.query('SELECT COUNT(*)::INTEGER AS count FROM Products');
    if (productCount.rows[0].count === 0) {
        await postgresPool.query(`
            INSERT INTO Products (user_id, sku, name, category, price, cost_price, stock_quantity, min_stock_alert)
            VALUES
                (1, 'PRD-1001', 'Wireless Mouse', 'Electronics', 1500.00, 950.00, 45, 10),
                (1, 'PRD-1002', 'Mechanical Keyboard', 'Electronics', 4500.00, 3200.00, 20, 5),
                (1, 'PRD-1003', 'USB-C Charging Cable 2m', 'Accessories', 850.00, 400.00, 8, 10),
                (1, 'PRD-1004', 'HD LED Monitor 24-inch', 'Electronics', 28500.00, 22000.00, 12, 3),
                (1, 'PRD-1005', 'Ergonomic Desk Chair', 'Furniture', 18500.00, 13500.00, 4, 5)
            ON CONFLICT (user_id, sku) DO NOTHING
        `);
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
                    purchase_unit_cost DECIMAL(18, 2) NULL,
                    purchase_total DECIMAL(18, 2) NULL,
                    created_at DATETIME DEFAULT GETDATE()
                );
            END;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('StockHistory') AND name = 'purchase_unit_cost')
            BEGIN
                ALTER TABLE StockHistory ADD purchase_unit_cost DECIMAL(18, 2) NULL;
            END;

            IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('StockHistory') AND name = 'purchase_total')
            BEGIN
                ALTER TABLE StockHistory ADD purchase_total DECIMAL(18, 2) NULL;
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
        const adminCredentials = getInitialAdminCredentials();
        if (userCheck.recordset[0].count === 0 && adminCredentials) {
            const hash = await bcrypt.hash(adminCredentials.password, 10);
            const req = mssqlPool.request();
            req.input('username', sql.NVarChar, adminCredentials.username);
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
    const sqlite3 = require('sqlite3').verbose();

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
                    purchase_unit_cost REAL,
                    purchase_total REAL,
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
                    const migrateStockHistoryColumns = () => {
                        sqliteDb.all('PRAGMA table_info(StockHistory)', (stockColumnsErr, stockColumns) => {
                            if (stockColumnsErr) {
                                console.error('Error checking StockHistory table columns:', stockColumnsErr.message);
                                return reject(stockColumnsErr);
                            }

                            const stockColumnNames = new Set(stockColumns.map(column => column.name));
                            const missingColumns = [
                                ['purchase_unit_cost', 'REAL'],
                                ['purchase_total', 'REAL']
                            ].filter(([name]) => !stockColumnNames.has(name));

                            const addNextColumn = () => {
                                if (missingColumns.length === 0) {
                                    return resolve();
                                }
                                const [name, type] = missingColumns.shift();
                                sqliteDb.run(`ALTER TABLE StockHistory ADD COLUMN ${name} ${type}`, alterErr => {
                                    if (alterErr) {
                                        console.error(`Error adding ${name} to StockHistory:`, alterErr.message);
                                        return reject(alterErr);
                                    }
                                    addNextColumn();
                                });
                            };

                            addNextColumn();
                        });
                    };
                    const createGmailIndex = () => {
                        sqliteDb.run(
                            'CREATE UNIQUE INDEX IF NOT EXISTS UX_Users_gmail ON Users(gmail) WHERE gmail IS NOT NULL',
                            (indexErr) => {
                                if (indexErr) {
                                    console.error('Error creating Gmail uniqueness index:', indexErr.message);
                                    return reject(indexErr);
                                }
                                migrateStockHistoryColumns();
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
                    const adminCredentials = getInitialAdminCredentials();
                    if (row && row.count === 0 && adminCredentials) {
                        const hash = await bcrypt.hash(adminCredentials.password, 10);
                        sqliteDb.run(
                            "INSERT INTO Users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)",
                            [adminCredentials.username, hash, 'System Administrator', 'Admin']
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

function preparePostgresQuery(sqlStr, params) {
    const keys = Object.keys(params);
    const parameterIndexes = new Map(keys.map((key, index) => [key, index + 1]));
    const text = sqlStr.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (placeholder, key) => {
        const index = parameterIndexes.get(key);
        if (index === undefined) {
            throw new Error(`Missing database parameter: ${key}`);
        }
        return `$${index}`;
    });

    return { text, values: keys.map(key => params[key]) };
}

// Unified Query Execution Helper
async function queryAll(sqlStr, params = {}) {
    if (dbType === 'POSTGRES') {
        const query = preparePostgresQuery(sqlStr, params);
        const result = await postgresPool.query(query.text, query.values);
        return result.rows;
    } else if (dbType === 'MSSQL') {
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
    if (dbType === 'POSTGRES') {
        const query = preparePostgresQuery(sqlStr, params);
        return postgresPool.query(query.text, query.values);
    } else if (dbType === 'MSSQL') {
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
