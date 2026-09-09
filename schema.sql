-- =========================================================
-- Sales & Inventory Management System - SSMS SQL Script
-- Execute this script in SQL Server Management Studio (SSMS)
-- Company: Sensometric Specialities (Dairy Products)
-- =========================================================

IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'SalesInventoryDB')
BEGIN
    CREATE DATABASE SalesInventoryDB;
END
GO

USE SalesInventoryDB;
GO

-- 1. Users Table (For client authentication & login)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
BEGIN
    CREATE TABLE Users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        username NVARCHAR(50) NOT NULL UNIQUE,
        password_hash NVARCHAR(255) NOT NULL,
        full_name NVARCHAR(100) NOT NULL,
        role NVARCHAR(20) DEFAULT 'Admin',
        created_at DATETIME DEFAULT GETDATE()
    );
END
GO

-- 2. Products Table (Stock and Inventory management - Sensometric Specialities Dairy Products)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
BEGIN
    CREATE TABLE Products (
        id INT IDENTITY(1,1) PRIMARY KEY,
        sku NVARCHAR(50) DEFAULT '',
        name NVARCHAR(150) NOT NULL,
        category NVARCHAR(50) DEFAULT 'Dairy Products',
        price DECIMAL(18, 2) NOT NULL,
        cost_price DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        stock_quantity INT NOT NULL DEFAULT 0,
        min_stock_alert INT NOT NULL DEFAULT 5,
        created_at DATETIME DEFAULT GETDATE()
    );
END
GO

-- 3. Orders Table (Sales Records with 18% GST, Email, Delivery Address & Udhaar support)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Orders')
BEGIN
    CREATE TABLE Orders (
        id INT IDENTITY(1,1) PRIMARY KEY,
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
END
GO

-- 4. OrderItems Table (Detailed Itemized Order History)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'OrderItems')
BEGIN
    CREATE TABLE OrderItems (
        id INT IDENTITY(1,1) PRIMARY KEY,
        order_id INT NOT NULL FOREIGN KEY REFERENCES Orders(id) ON DELETE CASCADE,
        product_id INT NOT NULL,
        product_name NVARCHAR(150) NOT NULL,
        quantity INT NOT NULL,
        unit_price DECIMAL(18, 2) NOT NULL,
        subtotal DECIMAL(18, 2) NOT NULL
    );
END
GO

-- 5. StockHistory Table (Audit Log of Inventory Changes)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StockHistory')
BEGIN
    CREATE TABLE StockHistory (
        id INT IDENTITY(1,1) PRIMARY KEY,
        product_id INT NOT NULL,
        product_name NVARCHAR(150) NOT NULL,
        quantity_change INT NOT NULL,
        change_type NVARCHAR(50) NOT NULL,
        notes NVARCHAR(255) DEFAULT '',
        created_at DATETIME DEFAULT GETDATE()
    );
END
GO

-- Insert default admin user if no users exist
IF NOT EXISTS (SELECT * FROM Users)
BEGIN
    INSERT INTO Users (username, password_hash, full_name, role)
    VALUES ('admin', '$2a$10$wE9l16S6sQnndESt.G5F.O1Y7H1iE5WfO3t0vR6z/x62mZ0W01O2e', 'System Administrator', 'Admin');
END
GO

-- Insert sample initial dairy inventory stock items if table is empty
IF NOT EXISTS (SELECT * FROM Products)
BEGIN
    INSERT INTO Products (sku, name, category, price, cost_price, stock_quantity, min_stock_alert)
    VALUES 
    ('DAIRY-101', 'Pure Cow Milk 1L', 'Dairy Products', 250.00, 180.00, 100, 15),
    ('DAIRY-102', 'Fresh Butter 250g', 'Dairy Specialities', 450.00, 320.00, 50, 10),
    ('DAIRY-103', 'Cheddar Cheese 500g', 'Dairy Specialities', 1200.00, 850.00, 30, 8),
    ('DAIRY-104', 'Desi Ghee 1kg Jar', 'Dairy Specialities', 2800.00, 2100.00, 25, 5),
    ('DAIRY-105', 'Fresh Plain Yogurt 1kg', 'Dairy Products', 320.00, 220.00, 60, 10);
END
GO
