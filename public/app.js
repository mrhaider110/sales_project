/* =========================================================
   Sensometric Specialities - Main Frontend SPA Script
   Sales and Distribution Management System
   ========================================================= */

// Application State
const state = {
    token: localStorage.getItem('sh_token') || null,
    user: JSON.parse(localStorage.getItem('sh_user')) || null,
    dbType: 'MSSQL',
    products: [],
    orders: [],
    stockHistory: [],
    monthlyAudit: null,
    cart: [],
    activeTab: 'createOrder'
};

// DOM Elements
const authContainer = document.getElementById('authContainer');
const mainApp = document.getElementById('mainApp');

// Helper headers
function authHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
    };
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Initial Load Handler
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setupEventListeners();
    checkAuth();
});

// Theme Setup
function initTheme() {
    const savedTheme = localStorage.getItem('sh_theme');
    document.body.className = savedTheme === 'dark-theme' ? 'dark-theme' : 'light-theme';
    updateThemeIcon();
}

function updateThemeIcon() {
    const toggleButton = document.getElementById('themeToggleBtn');
    const icon = toggleButton?.querySelector('i');
    const isLightTheme = document.body.classList.contains('light-theme');

    if (icon) {
        icon.className = isLightTheme ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }

    if (toggleButton) {
        toggleButton.title = isLightTheme ? 'Switch to dark theme' : 'Switch to light theme';
        toggleButton.setAttribute('aria-label', toggleButton.title);
    }

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
        themeColor.content = isLightTheme ? '#edf2f8' : '#0b182c';
    }
}

// Event Listeners setup
function setupEventListeners() {
    // Auth Form Toggle
    document.getElementById('showRegisterBtn')?.addEventListener('click', () => {
        document.getElementById('loginForm').classList.add('hidden');
        document.getElementById('registerForm').classList.remove('hidden');
        document.getElementById('authSubtitle').innerText = 'Sales and Distribution';
    });

    document.getElementById('showLoginBtn')?.addEventListener('click', () => {
        document.getElementById('registerForm').classList.add('hidden');
        document.getElementById('loginForm').classList.remove('hidden');
        document.getElementById('authSubtitle').innerText = 'Sales and Distribution';
    });

    // Login & Register Form Submission
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
    document.getElementById('registerForm')?.addEventListener('submit', handleRegister);

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);

    // Theme Toggle
    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        document.body.classList.toggle('dark-theme');
        const currentTheme = document.body.classList.contains('light-theme') ? 'light-theme' : 'dark-theme';
        localStorage.setItem('sh_theme', currentTheme);
        updateThemeIcon();
    });

    // Liquid Glass Sidebar Navigation Click Handler
    document.querySelectorAll('.liquid-glass-dock .nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetAccordionId = btn.getAttribute('data-target');

            document.querySelectorAll('.liquid-glass-dock .nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (targetAccordionId) {
                // Collapse all other accordions to simulate tab switching
                document.querySelectorAll('.accordion-card').forEach(card => {
                    if (card.id !== targetAccordionId) {
                        card.classList.add('collapsed');
                    }
                });

                const targetCard = document.getElementById(targetAccordionId);
                if (targetCard) {
                    targetCard.classList.remove('collapsed');
                    const mainContent = document.querySelector('.main-content');
                    if (mainContent) {
                        mainContent.scrollTo({ top: 0, behavior: 'smooth' });
                    } else {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                }
            }
        });
    });

    // Sidebar Search Input
    document.getElementById('sidebarSearch')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('.accordion-card').forEach(card => {
            const text = card.innerText.toLowerCase();
            if (!query || text.includes(query)) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });
    });

    // Add Product Modal Opener
    document.getElementById('openAddProductModal')?.addEventListener('click', () => {
        document.getElementById('modalProductTitle').innerText = 'Add New Product to Inventory';
        document.getElementById('productForm').reset();
        document.getElementById('prodId').value = '';
        updateProductCostRequirement();
        openModal('productModal');
    });

    // Product & Stock Form Submit
    document.getElementById('productForm')?.addEventListener('submit', handleProductSubmit);
    document.getElementById('prodStock')?.addEventListener('input', updateProductCostRequirement);
    document.getElementById('stockForm')?.addEventListener('submit', handleStockSubmit);
    document.getElementById('stockAdjustment')?.addEventListener('input', updateStockPurchaseCostRequirement);

    // Create Order Form submission & calculation
    document.getElementById('createOrderForm')?.addEventListener('submit', handleCreateOrderSubmit);
    document.getElementById('addOrderItemBtn')?.addEventListener('click', addOrderItemToCart);
    document.getElementById('orderCartBody')?.addEventListener('click', handleOrderCartClick);
    document.getElementById('itemQuantity')?.addEventListener('input', calculateOrderTotal);
    document.getElementById('itemPrice')?.addEventListener('input', calculateOrderTotal);
    document.getElementById('includeGstCheck')?.addEventListener('change', calculateOrderTotal);
    document.getElementById('itemSelect')?.addEventListener('change', handleItemSelectChange);

    // Inventory Search & Filters
    document.getElementById('inventorySearch')?.addEventListener('input', renderInventoryTable);
    document.getElementById('categoryFilter')?.addEventListener('change', renderInventoryTable);

    // Order History Filter & Refresh
    document.getElementById('historySearch')?.addEventListener('input', renderOrderHistory);
    document.getElementById('historyStatusFilter')?.addEventListener('change', renderOrderHistory);
    document.getElementById('refreshOrdersBtn')?.addEventListener('click', () => {
        fetchOrderHistory();
        fetchDashboardStats();
    });

    // Stock History Live Filters
    document.getElementById('stockHistorySearch')?.addEventListener('input', renderStockHistoryTable);
    document.getElementById('stockHistoryDateFilter')?.addEventListener('change', renderStockHistoryTable);
    document.getElementById('stockHistoryStatusFilter')?.addEventListener('change', renderStockHistoryTable);
    document.getElementById('refreshStockHistoryBtn')?.addEventListener('click', fetchStockHistory);

    // Export Buttons
    document.getElementById('exportExcelBtn')?.addEventListener('click', exportToExcel);
    document.getElementById('exportCsvBtn')?.addEventListener('click', exportToExcel);
    const now = new Date();
    document.getElementById('auditMonth').value =
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('generateMonthlyAuditBtn')?.addEventListener('click', generateMonthlyAudit);
    document.getElementById('downloadMonthlyAuditBtn')?.addEventListener('click', downloadMonthlyAudit);
    document.getElementById('printMonthlyAuditBtn')?.addEventListener('click', printMonthlyAudit);
}

// ----------------------------------------------------
// ACCORDION EXPAND / COLLAPSE
// ----------------------------------------------------
function toggleAccordion(id) {
    const card = document.getElementById(id);
    if (card) {
        card.classList.toggle('collapsed');
    }
}

// Modal helper
function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
}

function showConfirmDialog(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    if (!modal) {
        if (confirm(`${title}\n${message}`)) {
            onConfirm();
        }
        return;
    }

    const titleEl = document.getElementById('confirmModalTitle');
    const msgEl = document.getElementById('confirmModalMessage');
    if (titleEl) titleEl.innerText = title;
    if (msgEl) msgEl.innerText = message;

    const actionBtn = document.getElementById('confirmModalActionBtn');
    if (actionBtn) {
        const newBtn = actionBtn.cloneNode(true);
        actionBtn.parentNode.replaceChild(newBtn, actionBtn);
        newBtn.addEventListener('click', async () => {
            closeModal('confirmModal');
            await onConfirm();
        });
    }

    openModal('confirmModal');
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    const icon = document.getElementById('toastIcon');

    if (!toast || !msg) return;

    msg.innerText = message;
    if (type === 'error') {
        icon.className = 'fa-solid fa-circle-xmark text-danger';
    } else if (type === 'warning') {
        icon.className = 'fa-solid fa-triangle-exclamation text-warning';
    } else {
        icon.className = 'fa-solid fa-circle-check text-success';
    }

    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ----------------------------------------------------
// AUTHENTICATION LOGIC & SESSION MANAGEMENT
// ----------------------------------------------------
function isTokenExpired(token) {
    if (!token) return true;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
            base64 += '=';
        }
        const payload = JSON.parse(decodeURIComponent(escape(atob(base64))));
        if (payload.exp && Date.now() >= payload.exp * 1000) {
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

function checkAuth() {
    if (state.token && state.user) {
        if (isTokenExpired(state.token)) {
            handleLogout(false);
            showToast('Session expired. Please log in again.', 'warning');
            return;
        }

        authContainer.classList.add('hidden');
        mainApp.classList.remove('hidden');

        const displayName = state.user.fullName || state.user.username || 'User';
        const displayRole = state.user.role || 'Active User';

        if (document.getElementById('userDisplayName')) {
            document.getElementById('userDisplayName').innerText = displayName;
        }
        if (document.getElementById('userRole')) {
            document.getElementById('userRole').innerText = displayRole;
        }

        const avatarEl = document.querySelector('.user-avatar');
        if (avatarEl) {
            const initials = displayName
                .split(' ')
                .filter(Boolean)
                .map(n => n[0])
                .join('')
                .substring(0, 2)
                .toUpperCase() || 'U';
            avatarEl.innerText = initials;
        }

        // Fetch initial data for this specific user account
        fetchDashboardStats();
        fetchProducts();
        fetchOrderHistory();
        fetchStockHistory();
    } else {
        authContainer.classList.remove('hidden');
        mainApp.classList.add('hidden');
    }
}

// Global Fetch Interceptor to gracefully handle session expiration
const originalFetch = window.fetch.bind(window);
window.fetch = async function(...args) {
    const res = await originalFetch(...args);
    if ((res.status === 401 || res.status === 403) && state.token) {
        try {
            const clone = res.clone();
            const data = await clone.json();
            if (data && !data.success) {
                handleLogout(false);
                showToast('Session expired. Please log in again.', 'warning');
            }
        } catch (e) {
            handleLogout(false);
            showToast('Session expired. Please log in again.', 'warning');
        }
    }
    return res;
};

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (data.success) {
            // Reset in-memory state cleanly before loading the new user's dashboard
            state.products = [];
            state.orders = [];
            state.stockHistory = [];
            state.monthlyAudit = null;
            document.getElementById('monthlyAuditResults')?.classList.add('hidden');
            state.cart = [];
            renderOrderCart();
            calculateOrderTotal();

            state.token = data.token;
            state.user = data.user;
            localStorage.setItem('sh_token', data.token);
            localStorage.setItem('sh_user', JSON.stringify(data.user));

            showToast(`Welcome back, ${data.user.fullName || data.user.username}!`, 'success');
            checkAuth();
        } else {
            showToast(data.message, 'error');
        }
    } catch (err) {
        showToast('Connection error during login.', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const fullName = document.getElementById('regFullName').value.trim();
    const gmail = document.getElementById('regGmail').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName, gmail, username, password })
        });
        const data = await res.json();

        if (data.success) {
            showToast(data.message, 'success');
            document.getElementById('registerForm').classList.add('hidden');
            document.getElementById('loginForm').classList.remove('hidden');
            document.getElementById('loginUsername').value = username;
            document.getElementById('loginPassword').value = '';
        } else {
            showToast(data.message, 'error');
        }
    } catch (err) {
        showToast('Error registering user.', 'error');
    }
}

function handleLogout(showNotification = true) {
    state.token = null;
    state.user = null;
    state.products = [];
    state.orders = [];
    state.stockHistory = [];
    state.cart = [];
    renderOrderCart();
    calculateOrderTotal();
    localStorage.removeItem('sh_token');
    localStorage.removeItem('sh_user');

    // Reset KPI cards to 0
    if (document.getElementById('kpiTotalSalesPaid')) document.getElementById('kpiTotalSalesPaid').innerText = 'Rs.0.00';
    if (document.getElementById('kpiMarketPendingUdhaar')) document.getElementById('kpiMarketPendingUdhaar').innerText = 'Rs.0.00';
    if (document.getElementById('kpiTotalOrdersLogged')) document.getElementById('kpiTotalOrdersLogged').innerText = '0';
    if (document.getElementById('kpiTotalProductsCount')) document.getElementById('kpiTotalProductsCount').innerText = '0';
    if (document.getElementById('kpiTotalStockUnits')) document.getElementById('kpiTotalStockUnits').innerText = '0';
    if (document.getElementById('kpiLowStockAlerts')) document.getElementById('kpiLowStockAlerts').innerText = '0';

    // Clear tables
    renderInventoryTable();
    renderOrderHistory();
    renderStockHistoryTable();

    if (showNotification) {
        showToast('Logged out successfully.', 'info');
    }
    checkAuth();
}

// ----------------------------------------------------
// DASHBOARD METRICS & STATS
// ----------------------------------------------------
async function fetchDashboardStats() {
    try {
        const res = await fetch('/api/dashboard/stats', { headers: authHeaders() });
        const data = await res.json();

        if (data.success) {
            const { stats } = data;

            document.getElementById('kpiTotalSalesPaid').innerText = `Rs.${(stats.totalSalesPaid || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            document.getElementById('kpiMarketPendingUdhaar').innerText = `Rs.${(stats.marketPendingUdhaar || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            document.getElementById('kpiTotalOrdersLogged').innerText = stats.totalOrders || 0;

            const lowStock = stats.lowStockCount || 0;
            const lowStockElem = document.getElementById('kpiLowStockCount');
            if (lowStockElem) lowStockElem.innerText = lowStock;

            const subtextElem = document.getElementById('kpiLowStockSubtext');
            if (subtextElem) {
                subtextElem.innerHTML = lowStock > 0 
                    ? `<i class="fa-solid fa-triangle-exclamation text-danger"></i> ${lowStock} item${lowStock > 1 ? 's' : ''} low in stock`
                    : `<i class="fa-solid fa-circle-check text-success"></i> All stock healthy`;
            }
        }
    } catch (err) {
        console.error('Fetch stats error:', err);
    }
}

// ----------------------------------------------------
// INVENTORY MANAGEMENT
// ----------------------------------------------------
async function fetchProducts() {
    try {
        const res = await fetch('/api/products', { headers: authHeaders() });
        const data = await res.json();
        if (data.success) {
            state.products = data.products;
            renderInventoryTable();
            populateItemSelectDropdown();
        }
    } catch (err) {
        showToast('Error loading products.', 'error');
    }
}

function populateItemSelectDropdown() {
    const select = document.getElementById('itemSelect');
    if (!select) return;

    select.innerHTML = '<option value="">-- Select Product from Inventory or Enter Below --</option>' + 
        state.products.map(p => `
            <option value="${p.id}" data-name="${escapeHtml(p.name)}" data-price="${p.price}">
                ${escapeHtml(p.name)} - Rs.${parseFloat(p.price).toFixed(2)} [Stock: ${p.stock_quantity}]
            </option>
        `).join('');
}

function handleItemSelectChange(e) {
    const selectedOption = e.target.options[e.target.selectedIndex];
    if (!selectedOption || !selectedOption.value) return;

    const prodName = selectedOption.getAttribute('data-name');
    const prodPrice = selectedOption.getAttribute('data-price');

    if (prodName) document.getElementById('itemName').value = prodName;
    if (prodPrice) document.getElementById('itemPrice').value = prodPrice;

    calculateOrderTotal();
}

function renderInventoryTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    const searchTerm = (document.getElementById('inventorySearch')?.value || '').toLowerCase();
    const category = document.getElementById('categoryFilter')?.value || '';

    const filtered = state.products.filter(p => {
        const matchSearch = p.name.toLowerCase().includes(searchTerm) || 
                            p.category.toLowerCase().includes(searchTerm);
        const matchCat = !category || p.category === category;
        return matchSearch && matchCat;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No matching products in inventory.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(p => {
        const qty = p.stock_quantity || 0;
        const minAlert = p.min_stock_alert || 5;
        const isOut = qty <= 0;
        const isLow = qty <= minAlert;

        // Stock Meter Calculations
        let percentage = 0;
        let fillClass = 'meter-fill-healthy';
        let textClass = 'meter-text-healthy';
        let levelText = 'Healthy';
        let icon = '<i class="fa-solid fa-circle-check"></i>';

        if (isOut) {
            percentage = 0;
            fillClass = 'meter-fill-empty';
            textClass = 'meter-text-empty';
            levelText = 'Empty';
            icon = '<i class="fa-solid fa-ban"></i>';
        } else if (isLow) {
            // Low / Critical warning
            percentage = Math.max(12, Math.min(100, Math.round((qty / minAlert) * 45)));
            fillClass = 'meter-fill-critical';
            textClass = 'meter-text-critical';
            levelText = `Critical (${qty}/${minAlert})`;
            icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
        } else if (qty <= minAlert * 2) {
            // Moderate warning
            percentage = Math.min(75, Math.round((qty / (minAlert * 2)) * 75));
            fillClass = 'meter-fill-warning';
            textClass = 'meter-text-warning';
            levelText = `Moderate (${qty})`;
            icon = '<i class="fa-solid fa-circle-exclamation"></i>';
        } else {
            // Optimal stock level
            percentage = Math.min(100, Math.max(50, Math.round((qty / (minAlert * 3)) * 100)));
            fillClass = 'meter-fill-healthy';
            textClass = 'meter-text-healthy';
            levelText = `Optimal (${qty})`;
            icon = '<i class="fa-solid fa-circle-check"></i>';
        }

        let statusBadge = `<span class="badge badge-paid"><i class="fa-solid fa-check"></i> In Stock</span>`;
        if (isOut) {
            statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Out of Stock</span>`;
        } else if (isLow) {
            statusBadge = `<span class="badge badge-udhaar"><i class="fa-solid fa-triangle-exclamation"></i> Low (${qty})</span>`;
        }

        return `
            <tr>
                <td><strong>${escapeHtml(p.name)}</strong></td>
                <td>${escapeHtml(p.category)}</td>
                <td>Rs.${parseFloat(p.price).toFixed(2)}</td>
                <td>Rs.${parseFloat(p.cost_price || 0).toFixed(2)}</td>
                <td><strong>${qty}</strong></td>
                <td class="stock-meter-cell">
                    <div class="stock-meter-container" title="Current Stock: ${qty} | Alert Threshold: ${minAlert}">
                        <div class="stock-meter-header">
                            <span class="stock-meter-level-text ${textClass}">${icon} ${levelText}</span>
                            <span class="${textClass}">${percentage}%</span>
                        </div>
                        <div class="stock-meter-track">
                            <div class="stock-meter-fill ${fillClass}" style="width: ${percentage}%;"></div>
                        </div>
                    </div>
                </td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-outline-sm" onclick="openStockModal(${p.id})" title="Adjust Stock">
                        <i class="fa-solid fa-arrows-rotate"></i> Stock
                    </button>
                    <button class="btn btn-outline-sm" onclick="editProduct(${p.id})" title="Edit Product">
                        <i class="fa-solid fa-pen"></i> Edit
                    </button>
                    <button class="btn btn-outline-sm text-danger" onclick="deleteProduct(${p.id}, '${escapeHtml(p.name).replace(/'/g, "\\'")}')" title="Delete Product">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function handleProductSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('prodId').value;
    const name = document.getElementById('prodName').value.trim();
    const category = document.getElementById('prodCategory').value.trim();
    const price = document.getElementById('prodPrice').value;
    const costPrice = document.getElementById('prodCost').value;
    const stockQuantity = document.getElementById('prodStock').value;
    const minStockAlert = document.getElementById('prodMinAlert').value;

    const payload = { name, category, price, costPrice, stockQuantity, minStockAlert };
    const url = id ? `/api/products/${id}` : '/api/products';
    const method = id ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            showToast(data.message, 'success');
            closeModal('productModal');
            fetchProducts();
            fetchDashboardStats();
            fetchStockHistory();
        } else {
            showToast(data.message, 'error');
        }
    } catch (err) {
        showToast('Error saving product.', 'error');
    }
}

function editProduct(id) {
    const prod = state.products.find(p => p.id === id);
    if (!prod) return;

    document.getElementById('modalProductTitle').innerText = 'Edit Product Details';
    document.getElementById('prodId').value = prod.id;
    document.getElementById('prodName').value = prod.name;
    document.getElementById('prodCategory').value = prod.category;
    document.getElementById('prodPrice').value = prod.price;
    document.getElementById('prodCost').value = prod.cost_price || 0;
    document.getElementById('prodStock').value = prod.stock_quantity;
    document.getElementById('prodMinAlert').value = prod.min_stock_alert;

    updateProductCostRequirement();
    openModal('productModal');
}

function updateProductCostRequirement() {
    const isNewProduct = !document.getElementById('prodId')?.value;
    const initialStock = Number(document.getElementById('prodStock')?.value);
    const costInput = document.getElementById('prodCost');
    if (costInput) {
        costInput.required = isNewProduct && Number.isFinite(initialStock) && initialStock > 0;
    }
}

function openStockModal(id) {
    const prod = state.products.find(p => p.id === id);
    if (!prod) return;

    document.getElementById('stockProdId').value = prod.id;
    document.getElementById('stockProdName').innerText = prod.name;
    document.getElementById('stockCurrentQty').innerText = prod.stock_quantity;
    document.getElementById('stockAdjustment').value = '';
    document.getElementById('stockNotes').value = '';
    document.getElementById('stockPurchaseUnitCost').value = '';
    updateStockPurchaseCostRequirement();

    openModal('stockModal');
}

function updateStockPurchaseCostRequirement() {
    const adjustment = Number(document.getElementById('stockAdjustment')?.value);
    const costInput = document.getElementById('stockPurchaseUnitCost');
    if (!costInput) return;

    costInput.required = Number.isFinite(adjustment) && adjustment > 0;
}

async function handleStockSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('stockProdId').value;
    const adjustmentQuantity = document.getElementById('stockAdjustment').value;
    const purchaseUnitCost = document.getElementById('stockPurchaseUnitCost').value;
    const notes = document.getElementById('stockNotes').value.trim();

    try {
        const res = await fetch(`/api/products/${id}/stock`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ adjustmentQuantity, purchaseUnitCost, notes })
        });
        const data = await res.json();

        if (data.success) {
            showToast(data.message, 'success');
            closeModal('stockModal');
            fetchProducts();
            fetchDashboardStats();
            fetchStockHistory();
        } else {
            showToast(data.message, 'error');
        }
    } catch (err) {
        showToast('Error updating stock level.', 'error');
    }
}

async function deleteProduct(id, productName) {
    const name = productName || 'this product';
    showConfirmDialog('Delete Product?', `Are you sure you want to delete "${name}" from inventory?`, async () => {
        try {
            const res = await fetch(`/api/products/${id}`, {
                method: 'DELETE',
                headers: authHeaders()
            });
            const data = await res.json();

            if (data.success) {
                showToast(data.message, 'success');
                fetchProducts();
                fetchDashboardStats();
                fetchStockHistory();
            } else {
                showToast(data.message, 'error');
            }
        } catch (err) {
            showToast('Error deleting product.', 'error');
        }
    });
}

// ----------------------------------------------------
// CREATE NEW ORDER FORM LOGIC
// ----------------------------------------------------
function calculateOrderTotal() {
    const quantity = Number(document.getElementById('itemQuantity')?.value) || 0;
    const price = Number(document.getElementById('itemPrice')?.value) || 0;
    const itemName = document.getElementById('itemName')?.value.trim();
    const selectedProduct = document.getElementById('itemSelect')?.value;
    const includeGst = document.getElementById('includeGstCheck')?.checked || false;

    const cartSubtotal = state.cart.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
    const hasCurrentItem = Boolean(itemName || selectedProduct);
    const currentItemSubtotal = hasCurrentItem ? quantity * price : 0;
    const subtotal = cartSubtotal + currentItemSubtotal;
    const tax = includeGst ? (subtotal * 0.18) : 0;
    const totalPayable = Math.max(0, subtotal + tax);

    const display = document.getElementById('totalPayableDisplay');
    if (display) {
        display.innerText = `Rs.${totalPayable.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    }
}

function getCurrentOrderItem() {
    const itemName = document.getElementById('itemName')?.value.trim() || '';
    const productId = Number(document.getElementById('itemSelect')?.value) || 0;
    const quantityValue = document.getElementById('itemQuantity')?.value;
    const priceValue = document.getElementById('itemPrice')?.value;
    const quantity = Number(quantityValue);
    const unitPrice = Number(priceValue);

    if (!itemName) {
        showToast('Please enter or select an Item Name.', 'warning');
        return null;
    }

    if (!Number.isInteger(quantity) || quantity <= 0 || priceValue === '' || !Number.isFinite(unitPrice) || unitPrice < 0) {
        showToast('Please enter a valid Quantity and Price.', 'warning');
        return null;
    }

    return { productId, productName: itemName, quantity, unitPrice };
}

function resetOrderItemInputs() {
    document.getElementById('itemSelect').value = '';
    document.getElementById('itemName').value = '';
    document.getElementById('itemQuantity').value = '1';
    document.getElementById('itemPrice').value = '';
}

function addOrderItemToCart() {
    const item = getCurrentOrderItem();
    if (!item) return;

    const existingItem = item.productId > 0
        ? state.cart.find(cartItem =>
            cartItem.productId === item.productId &&
            cartItem.productName === item.productName &&
            cartItem.unitPrice === item.unitPrice
        )
        : null;

    if (existingItem) {
        existingItem.quantity += item.quantity;
    } else {
        state.cart.push(item);
    }

    resetOrderItemInputs();
    renderOrderCart();
    calculateOrderTotal();
}

function renderOrderCart() {
    const tbody = document.getElementById('orderCartBody');
    const count = document.getElementById('orderCartCount');
    if (!tbody) return;

    if (count) {
        count.textContent = `${state.cart.length} line item${state.cart.length === 1 ? '' : 's'}`;
    }

    if (state.cart.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="order-cart-empty">No items added yet.</td></tr>';
        return;
    }

    tbody.innerHTML = state.cart.map((item, index) => `
        <tr>
            <td><strong>${escapeHtml(item.productName)}</strong></td>
            <td>${item.quantity}</td>
            <td>Rs.${item.unitPrice.toFixed(2)}</td>
            <td>Rs.${(item.quantity * item.unitPrice).toFixed(2)}</td>
            <td>
                <button type="button" class="btn-outline-sm text-danger" data-remove-cart-item="${index}" aria-label="Remove ${escapeHtml(item.productName)}">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function handleOrderCartClick(event) {
    const removeButton = event.target.closest('[data-remove-cart-item]');
    if (!removeButton) return;

    const index = Number(removeButton.dataset.removeCartItem);
    if (!Number.isInteger(index) || index < 0 || index >= state.cart.length) return;

    state.cart.splice(index, 1);
    renderOrderCart();
    calculateOrderTotal();
}

async function handleCreateOrderSubmit(e) {
    e.preventDefault();

    const customerName = document.getElementById('custName')?.value.trim() || 'Walk-in Customer';
    const customerPhone = document.getElementById('custPhone')?.value.trim() || '';
    const customerEmail = document.getElementById('custEmail')?.value.trim() || '';
    const deliveryAddress = document.getElementById('deliveryAddress')?.value.trim() || '';
    const isUdhaar = document.getElementById('markUdhaarCheck')?.checked || false;
    const includeGst = document.getElementById('includeGstCheck')?.checked || false;
    const hasCurrentItem = Boolean(
        document.getElementById('itemName')?.value.trim() ||
        document.getElementById('itemSelect')?.value ||
        document.getElementById('itemPrice')?.value
    );
    const currentItem = hasCurrentItem ? getCurrentOrderItem() : null;
    if (hasCurrentItem && !currentItem) return;

    const items = [...state.cart, ...(currentItem ? [currentItem] : [])];

    if (items.length === 0) {
        showToast('Add at least one item to the invoice.', 'warning');
        return;
    }

    const orderData = {
        customerName,
        customerPhone,
        customerEmail,
        deliveryAddress,
        items,
        discount: 0,
        paymentMethod: isUdhaar ? 'Credit' : 'Cash',
        paymentStatus: isUdhaar ? 'Udhaar' : 'Paid',
        includeGst: includeGst
    };

    try {
        const res = await fetch('/api/orders', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(orderData)
        });
        const data = await res.json();

        if (data.success) {
            showToast('Order confirmed and saved successfully!', 'success');
            
            // Show Invoice Modal
            showInvoiceReceipt(data.order.id);

            // Reset Form
            document.getElementById('createOrderForm').reset();
            state.cart = [];
            renderOrderCart();
            document.getElementById('includeGstCheck').checked = true;
            calculateOrderTotal();

            // Refresh Portal Data
            fetchProducts();
            fetchDashboardStats();
            fetchOrderHistory();
            fetchStockHistory();
        } else {
            showToast(data.message, 'error');
        }
    } catch (err) {
        showToast('Error saving order.', 'error');
    }
}

// ----------------------------------------------------
// ORDERS HISTORY (WITH DELETE OPTION & PRODUCT NAME)
// ----------------------------------------------------
async function fetchOrderHistory() {
    try {
        const res = await fetch('/api/orders', { headers: authHeaders() });
        const data = await res.json();
        if (data.success) {
            state.orders = data.orders;
            renderOrderHistory();
        }
    } catch (err) {
        console.error('Error fetching order history:', err);
    }
}

function renderOrderHistory() {
    const tbody = document.getElementById('orderHistoryTableBody');
    if (!tbody) return;

    const searchTerm = (document.getElementById('historySearch')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('historyStatusFilter')?.value || '';

    const filtered = state.orders.filter(o => {
        const matchSearch = o.order_number.toLowerCase().includes(searchTerm) ||
                            (o.customer_name || '').toLowerCase().includes(searchTerm) ||
                            (o.product_name || '').toLowerCase().includes(searchTerm) ||
                            (o.customer_phone || '').toLowerCase().includes(searchTerm);
        const matchStatus = !statusFilter || (o.payment_status || 'Paid') === statusFilter;
        return matchSearch && matchStatus;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No sales orders found.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(o => {
        const isUdhaar = (o.payment_status || 'Paid').toLowerCase().includes('udhaar') || (o.payment_status || '').toLowerCase().includes('credit');
        const statusBadge = isUdhaar 
            ? `<span class="badge badge-udhaar"><i class="fa-solid fa-clock"></i> Credit (Udhaar)</span>`
            : `<span class="badge badge-paid"><i class="fa-solid fa-check"></i> Paid</span>`;

        const productName = o.product_name || (o.items && o.items[0] ? o.items[0].product_name : `Order #${o.order_number}`);
        const pricePerItem = o.item_price || (o.items && o.items[0] ? o.items[0].unit_price : o.total_amount);
        const qty = o.item_quantity || (o.items && o.items[0] ? o.items[0].quantity : 1);

        return `
            <tr>
                <td><small>${new Date(o.created_at).toLocaleDateString()}</small></td>
                <td><strong>${escapeHtml(o.customer_name)}</strong></td>
                <td><strong>${escapeHtml(productName)}</strong></td>
                <td>Rs.${parseFloat(pricePerItem).toFixed(2)}</td>
                <td>${qty}</td>
                <td><strong>Rs.${parseFloat(o.net_amount).toFixed(2)}</strong></td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-outline-sm" onclick="showInvoiceReceipt(${o.id})" title="View Invoice">
                        <i class="fa-solid fa-file-invoice-dollar"></i> Invoice
                    </button>
                    ${isUdhaar ? `
                        <button class="btn btn-outline-sm text-success" onclick="markOrderAsPaid(${o.id})" title="Mark as Paid">
                            <i class="fa-solid fa-check"></i> Pay
                        </button>
                    ` : ''}
                    <button class="btn btn-outline-sm text-danger" onclick="deleteOrder(${o.id}, '${o.order_number}')" title="Delete Order">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function markOrderAsPaid(orderId) {
    try {
        const res = await fetch(`/api/orders/${orderId}/status`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ paymentStatus: 'Paid' })
        });
        const data = await res.json();

        if (data.success) {
            showToast('Order status updated to Paid!', 'success');
            fetchOrderHistory();
            fetchDashboardStats();
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Error updating order payment status.', 'error');
    }
}

async function deleteOrder(orderId, orderNum) {
    const num = orderNum || orderId;
    showConfirmDialog('Delete Order?', `Are you sure you want to delete Order #${num}? This will restore the product stock and remove the order permanently.`, async () => {
        try {
            const res = await fetch(`/api/orders/${orderId}`, {
                method: 'DELETE',
                headers: authHeaders()
            });
            const data = await res.json();

            if (data.success) {
                showToast(data.message, 'success');
                fetchOrderHistory();
                fetchProducts();
                fetchDashboardStats();
                fetchStockHistory();
            } else {
                showToast(data.message, 'error');
            }
        } catch (err) {
            showToast('Error deleting order.', 'error');
        }
    });
}

// ----------------------------------------------------
// SENSOMETRIC SPECIALITIES INVOICE
// ----------------------------------------------------
async function showInvoiceReceipt(orderId) {
    try {
        const res = await fetch(`/api/orders/${orderId}`, { headers: authHeaders() });
        const data = await res.json();

        if (data.success) {
            const { order, items } = data;
            const container = document.getElementById('printableInvoice');

            const subtotal = parseFloat(order.total_amount || 0);
            const taxAmount = parseFloat(order.tax_amount || 0);
            const discount = parseFloat(order.discount || 0);
            const netAmount = parseFloat(order.net_amount || 0);
            const isUdhaar = (order.payment_status || 'Paid').toLowerCase().includes('udhaar') || (order.payment_status || '').toLowerCase().includes('credit');

            container.innerHTML = `
                <div class="invoice-header-box">
                    <h2>SENSOMETRIC SPECIALITIES</h2>
                    <p style="font-weight: 700; color: #475569; font-size: 14px; margin-top: 4px;">Sales and Distribution</p>
                </div>

                <div class="invoice-meta-grid">
                    <div>
                        <p><strong>Order #:</strong> ${order.order_number}</p>
                        <p><strong>Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>
                        <p><strong>Payment Method:</strong> ${order.payment_method}</p>
                    </div>
                    <div>
                        <p><strong>Customer Name:</strong> ${escapeHtml(order.customer_name)}</p>
                        <p><strong>Phone:</strong> ${escapeHtml(order.customer_phone || 'N/A')}</p>
                        <p><strong>Email:</strong> ${escapeHtml(order.customer_email || 'N/A')}</p>
                        <p><strong>Delivery Address:</strong> ${escapeHtml(order.delivery_address || 'N/A')}</p>
                        <p><strong>Payment Status:</strong> 
                            <strong style="color: ${isUdhaar ? '#d97706' : '#059669'};">
                                ${isUdhaar ? 'CREDIT (UDHAAR)' : 'PAID IN FULL'}
                            </strong>
                        </p>
                    </div>
                </div>

                <table class="invoice-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Item Description</th>
                            <th>Qty</th>
                            <th>Unit Price</th>
                            <th>Subtotal</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((item, idx) => `
                            <tr>
                                <td>${idx + 1}</td>
                                <td><strong>${escapeHtml(item.product_name)}</strong></td>
                                <td>${item.quantity}</td>
                                <td>Rs.${parseFloat(item.unit_price).toFixed(2)}</td>
                                <td>Rs.${parseFloat(item.subtotal).toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="invoice-totals-box">
                    <div class="flex-between"><span>Items Subtotal:</span> <span>Rs.${subtotal.toFixed(2)}</span></div>
                    ${taxAmount > 0 ? `
                        <div class="flex-between"><span>CGST (9%):</span> <span>Rs.${(taxAmount / 2).toFixed(2)}</span></div>
                        <div class="flex-between"><span>SGST (9%):</span> <span>Rs.${(taxAmount / 2).toFixed(2)}</span></div>
                        <div class="flex-between" style="font-weight: 700;"><span>Total GST (18%):</span> <span>Rs.${taxAmount.toFixed(2)}</span></div>
                    ` : '<div class="flex-between"><span>GST (0%):</span> <span>Rs.0.00</span></div>'}
                    ${discount > 0 ? `<div class="flex-between"><span>Discount:</span> <span>-Rs.${discount.toFixed(2)}</span></div>` : ''}
                    <hr style="margin: 4px 0; border: none; border-top: 1px dashed #cbd5e1;">
                    <div class="flex-between" style="font-size: 16px; font-weight: 800; color: #0f172a;">
                        <span>Grand Total Payable:</span> <span>Rs.${netAmount.toFixed(2)}</span>
                    </div>
                </div>

                <div style="clear: both;"></div>
                <div style="margin-top: 24px; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 11px; color: #64748b;">
                    Thank you for choosing Sensometric Specialities! Computer generated Sales and Distribution invoice.
                </div>
            `;

            openModal('invoiceModal');
        }
    } catch (err) {
        showToast('Error displaying invoice.', 'error');
    }
}

// ----------------------------------------------------
// STOCK AUDIT HISTORY LOG WITH LIVE FILTERS
// ----------------------------------------------------
async function fetchStockHistory() {
    try {
        const res = await fetch('/api/stock-history', { headers: authHeaders() });
        const data = await res.json();
        if (data.success) {
            state.stockHistory = data.history;
            renderStockHistoryTable();
        }
    } catch (err) {
        console.error('Error loading stock audit log:', err);
    }
}

function renderStockHistoryTable() {
    const tbody = document.getElementById('stockHistoryTableBody');
    if (!tbody) return;

    const searchTerm = (document.getElementById('stockHistorySearch')?.value || '').toLowerCase();
    const dateFilter = document.getElementById('stockHistoryDateFilter')?.value || '';
    const statusFilter = document.getElementById('stockHistoryStatusFilter')?.value || '';

    const filtered = (state.stockHistory || []).filter(h => {
        const matchSearch = !searchTerm || 
            (h.product_name || '').toLowerCase().includes(searchTerm) || 
            (h.notes || '').toLowerCase().includes(searchTerm) ||
            (h.change_type || '').toLowerCase().includes(searchTerm);

        let matchDate = true;
        if (dateFilter && h.created_at) {
            const entryDate = new Date(h.created_at).toISOString().split('T')[0];
            matchDate = (entryDate === dateFilter);
        }

        let matchStatus = true;
        if (statusFilter) {
            const notes = (h.notes || '').toLowerCase();
            const changeType = (h.change_type || '').toLowerCase();

            if (statusFilter === 'Paid') {
                matchStatus = notes.includes('paid') || (!notes.includes('credit') && !notes.includes('udhaar') && changeType.includes('sale'));
            } else if (statusFilter === 'Credit') {
                matchStatus = notes.includes('credit') || notes.includes('udhaar');
            } else if (statusFilter === 'Restock') {
                matchStatus = changeType.includes('restock');
            } else if (statusFilter === 'Initial Stock') {
                matchStatus = changeType.includes('initial');
            }
        }

        return matchSearch && matchDate && matchStatus;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No matching stock history logs found.</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(h => {
        const isPos = h.quantity_change > 0;
        const qtyBadge = `<span class="badge ${isPos ? 'badge-paid' : 'badge-danger'}">${isPos ? '+' : ''}${h.quantity_change}</span>`;

        const notesText = (h.notes || '').toLowerCase();
        let typeBadgeClass = 'badge-udhaar';
        if (notesText.includes('paid')) typeBadgeClass = 'badge-paid';
        else if (notesText.includes('credit') || notesText.includes('udhaar')) typeBadgeClass = 'badge-udhaar';

        return `
            <tr>
                <td>#${h.id}</td>
                <td><strong>${escapeHtml(h.product_name)}</strong></td>
                <td>${qtyBadge}</td>
                <td><span class="badge ${typeBadgeClass}">${escapeHtml(h.change_type)}</span></td>
                <td>${escapeHtml(h.notes || '-')}</td>
                <td><small>${new Date(h.created_at).toLocaleString()}</small></td>
                <td>
                    <button class="btn btn-outline-sm text-danger" onclick="deleteStockHistoryEntry(${h.id})" title="Delete Log Entry">
                        <i class="fa-solid fa-trash"></i> Delete
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function deleteStockHistoryEntry(logId) {
    showConfirmDialog('Delete Stock History Entry?', `Are you sure you want to delete stock history log entry #${logId}?`, async () => {
        try {
            const res = await fetch(`/api/stock-history/${logId}`, {
                method: 'DELETE',
                headers: authHeaders()
            });
            const data = await res.json();

            if (data.success) {
                showToast('Stock history log entry deleted!', 'success');
                fetchStockHistory();
            } else {
                showToast(data.message, 'error');
            }
        } catch (err) {
            showToast('Error deleting stock history entry.', 'error');
        }
    });
}

async function generateMonthlyAudit() {
    const monthInput = document.getElementById('auditMonth');
    const month = monthInput.value;
    const message = document.getElementById('monthlyAuditMessage');
    const results = document.getElementById('monthlyAuditResults');
    const downloadButton = document.getElementById('downloadMonthlyAuditBtn');
    const printButton = document.getElementById('printMonthlyAuditBtn');

    if (!month) {
        showToast('Choose a month to generate the audit report.', 'warning');
        return;
    }

    state.monthlyAudit = null;
    results.classList.add('hidden');
    downloadButton.disabled = true;
    printButton.disabled = true;
    message.textContent = 'Generating monthly audit...';

    try {
        const res = await fetch(`/api/reports/monthly-audit?month=${encodeURIComponent(month)}`, {
            headers: authHeaders()
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
            message.textContent = data.message || 'Could not generate the monthly audit report.';
            showToast(message.textContent, 'error');
            return;
        }

        state.monthlyAudit = data.report;
        renderMonthlyAudit(data.report);
        results.classList.remove('hidden');
        downloadButton.disabled = false;
        printButton.disabled = false;
        message.textContent = `Audit report generated for ${formatAuditMonth(month)}.`;
    } catch (err) {
        message.textContent = 'Connection error while generating the monthly audit report.';
        showToast(message.textContent, 'error');
    }
}

function formatAuditMoney(value) {
    return `Rs.${Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function formatAuditMonth(month) {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Date(year, monthNumber - 1, 1).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric'
    });
}

function formatAuditDate(value) {
    return value ? new Date(value).toLocaleDateString() : '-';
}

function renderMonthlyAudit(report) {
    const summary = report.summary;
    const cards = [
        ['Sales orders', summary.orderCount],
        ['Total sales', formatAuditMoney(summary.totalSales)],
        ['Sales with GST', formatAuditMoney(summary.salesWithGst)],
        ['Sales without GST', formatAuditMoney(summary.salesWithoutGst)],
        ['GST collected', formatAuditMoney(summary.gstCollected)],
        ['Orders with GST', summary.gstSalesCount],
        ['Orders without GST', summary.nonGstSalesCount],
        ['Paid sales', formatAuditMoney(summary.paidSales)],
        ['Credit sales', formatAuditMoney(summary.creditSales)],
        ['Items sold', summary.totalItemsSold],
        ['Stock purchase cost', formatAuditMoney(summary.stockPurchaseCost)],
        ['Stock purchased', summary.stockPurchaseQuantity],
        ['Purchase entries', summary.stockPurchaseEntries]
    ];

    document.getElementById('auditPeriodLabel').textContent =
        `Sales and stock purchase audit for ${formatAuditMonth(report.month)}.`;
    document.getElementById('monthlyAuditSummary').innerHTML = cards.map(([label, value]) => `
        <div class="audit-summary-card">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(String(value))}</strong>
        </div>
    `).join('');

    const costNotice = document.getElementById('monthlyAuditCostNotice');
    if (summary.stockPurchaseQuantityWithoutCost > 0) {
        costNotice.textContent =
            `${summary.stockPurchaseQuantityWithoutCost} incoming stock unit(s) have no saved purchase cost. These may be older records; their cost is not included in the purchase total.`;
        costNotice.classList.remove('hidden');
    } else {
        costNotice.textContent = '';
        costNotice.classList.add('hidden');
    }

    const salesBody = document.getElementById('monthlyAuditSalesBody');
    salesBody.innerHTML = report.sales.length
        ? report.sales.map(order => `
            <tr>
                <td>${escapeHtml(formatAuditDate(order.created_at))}</td>
                <td>${escapeHtml(order.order_number)}</td>
                <td>${escapeHtml(order.customer_name || 'Walk-in Customer')}</td>
                <td>${Number(order.itemCount || 0)}</td>
                <td>${order.gstApplied ? 'Yes' : 'No'}</td>
                <td>${formatAuditMoney(order.tax_amount)}</td>
                <td>${escapeHtml(order.payment_status || 'Paid')}</td>
                <td>${formatAuditMoney(order.net_amount)}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="8" class="text-center">No sales recorded for this month.</td></tr>';

    const purchasesBody = document.getElementById('monthlyAuditPurchasesBody');
    purchasesBody.innerHTML = report.stockPurchases.length
        ? report.stockPurchases.map(entry => `
            <tr>
                <td>${escapeHtml(formatAuditDate(entry.created_at))}</td>
                <td>${escapeHtml(entry.product_name)}</td>
                <td>${Number(entry.quantity_change)}</td>
                <td>${entry.purchase_unit_cost === null || entry.purchase_unit_cost === undefined
                    ? 'Not recorded'
                    : formatAuditMoney(entry.purchase_unit_cost)}</td>
                <td>${entry.purchase_total === null || entry.purchase_total === undefined
                    ? 'Not recorded'
                    : formatAuditMoney(entry.purchase_total)}</td>
                <td>${escapeHtml(entry.notes || '-')}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="6" class="text-center">No stock purchases recorded for this month.</td></tr>';
}

function csvCell(value) {
    const text = String(value === null || value === undefined ? '' : value);
    const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safeText.replace(/"/g, '""')}"`;
}

function downloadMonthlyAudit() {
    const report = state.monthlyAudit;
    if (!report) return;

    const rows = [
        ['Sensometric Specialities Monthly Audit', formatAuditMonth(report.month)],
        [],
        ['Summary'],
        ['Sales orders', report.summary.orderCount],
        ['Total sales (Rs.)', report.summary.totalSales],
        ['Sales with GST (Rs.)', report.summary.salesWithGst],
        ['Orders with GST', report.summary.gstSalesCount],
        ['Sales without GST (Rs.)', report.summary.salesWithoutGst],
        ['Orders without GST', report.summary.nonGstSalesCount],
        ['GST collected (Rs.)', report.summary.gstCollected],
        ['Paid sales (Rs.)', report.summary.paidSales],
        ['Credit sales (Rs.)', report.summary.creditSales],
        ['Items sold', report.summary.totalItemsSold],
        ['Stock purchase entries', report.summary.stockPurchaseEntries],
        ['Stock purchased quantity', report.summary.stockPurchaseQuantity],
        ['Known stock purchase cost (Rs.)', report.summary.stockPurchaseCost],
        ['Stock quantity without recorded cost', report.summary.stockPurchaseQuantityWithoutCost],
        [],
        ['Sales'],
        ['Date', 'Order Number', 'Customer', 'Items Sold', 'GST Applied', 'GST Amount (Rs.)', 'Payment Status', 'Total (Rs.)'],
        ...report.sales.map(order => [
            formatAuditDate(order.created_at),
            order.order_number,
            order.customer_name || 'Walk-in Customer',
            order.itemCount,
            order.gstApplied ? 'Yes' : 'No',
            order.tax_amount,
            order.payment_status || 'Paid',
            order.net_amount
        ]),
        [],
        ['Stock Purchases'],
        ['Date', 'Product', 'Quantity', 'Unit Cost (Rs.)', 'Purchase Total (Rs.)', 'Notes'],
        ...report.stockPurchases.map(entry => [
            formatAuditDate(entry.created_at),
            entry.product_name,
            entry.quantity_change,
            entry.purchase_unit_cost ?? 'Not recorded',
            entry.purchase_total ?? 'Not recorded',
            entry.notes || ''
        ])
    ];
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sensometric_monthly_audit_${report.month}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function printMonthlyAudit() {
    if (!state.monthlyAudit) return;
    document.body.classList.add('print-monthly-audit');
    try {
        window.print();
    } finally {
        document.body.classList.remove('print-monthly-audit');
    }
}

// ----------------------------------------------------
// EXPORT TO EXCEL / CSV helper
// ----------------------------------------------------
function exportToExcel() {
    if (!state.orders || state.orders.length === 0) {
        showToast('No sales data available to export.', 'warning');
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Order Number,Customer Name,Phone,Email,Delivery Address,Product Name,Payment Method,Payment Status,Subtotal (Rs),GST Tax 18% (Rs),Net Amount (Rs),Date\n";

    state.orders.forEach(o => {
        const productName = o.product_name || (o.items && o.items[0] ? o.items[0].product_name : 'Product');
        const row = [
            `"${o.order_number}"`,
            `"${(o.customer_name || '').replace(/"/g, '""')}"`,
            `"${(o.customer_phone || '').replace(/"/g, '""')}"`,
            `"${(o.customer_email || '').replace(/"/g, '""')}"`,
            `"${(o.delivery_address || '').replace(/"/g, '""')}"`,
            `"${productName.replace(/"/g, '""')}"`,
            `"${o.payment_method}"`,
            `"${o.payment_status || 'Paid'}"`,
            o.total_amount,
            o.tax_amount || 0,
            o.net_amount,
            `"${new Date(o.created_at).toLocaleString()}"`
        ].join(",");
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `sensometric_sales_report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Exported Sensometric Specialities report to Excel CSV file!', 'success');
}

// Explicit global attachments for HTML inline onclick handlers
window.toggleAccordion = toggleAccordion;
window.openModal = openModal;
window.closeModal = closeModal;
window.openStockModal = openStockModal;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.showInvoiceReceipt = showInvoiceReceipt;
window.markOrderAsPaid = markOrderAsPaid;
window.deleteOrder = deleteOrder;
window.deleteStockHistoryEntry = deleteStockHistoryEntry;
window.exportToExcel = exportToExcel;
window.calculateOrderTotal = calculateOrderTotal;

