const puppeteer = require('puppeteer');

(async () => {
    console.log('--- STARTING BROWSER AUTOMATION TEST ---');
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    } catch (e) {
        console.error('Failed to launch puppeteer:', e.message);
        return;
    }

    const page = await browser.newPage();
    
    // Capture console messages
    page.on('console', msg => {
        console.log(`[BROWSER CONSOLE ${msg.type().toUpperCase()}]:`, msg.text());
    });

    // Capture unhandled page errors
    page.on('pageerror', err => {
        console.error('[BROWSER UNCAUGHT ERROR]:', err.toString());
    });

    // Capture failed requests
    page.on('requestfailed', request => {
        console.error(`[BROWSER NETWORK FAILED]: ${request.method()} ${request.url()} - ${request.failure() ? request.failure().errorText : 'failed'}`);
    });

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    try {
        console.log('Navigating to http://localhost:3000 ...');
        await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
        console.log('Page loaded successfully.');

        // Check if login form is visible
        const isAuthVisible = await page.$eval('#authContainer', el => !el.classList.contains('hidden'));
        console.log('Is Auth Container visible?:', isAuthVisible);

        if (isAuthVisible) {
            console.log('Attempting login with admin / admin123...');
            await page.type('#loginUsername', 'admin');
            await page.type('#loginPassword', 'admin123');
            await page.click('#loginForm button[type="submit"]');
            await sleep(1500);
        }

        const isMainAppVisible = await page.$eval('#mainApp', el => !el.classList.contains('hidden'));
        console.log('Is Main App visible after login?:', isMainAppVisible);

        // Check Toast message if any
        const toastText = await page.$eval('#toastMessage', el => el.innerText).catch(() => '');
        console.log('Current toast message:', toastText);

        // 1. Test Tab Switching: Click "Stock & Inventory" tab
        console.log('Testing click on "Stock & Inventory" tab...');
        const inventoryTab = await page.$('button[data-tab="inventory"]');
        if (inventoryTab) {
            await inventoryTab.click();
            await sleep(500);
            const isInventoryVisible = await page.$eval('#accordion-inventory', el => !el.classList.contains('collapsed'));
            console.log('Is Stock & Inventory accordion uncollapsed?:', isInventoryVisible);
        } else {
            console.error('Inventory tab button NOT found!');
        }

        // 2. Test "+ Add Product" button
        console.log('Testing "+ Add Product" button...');
        const addProductBtn = await page.$('#openAddProductModal');
        if (addProductBtn) {
            await addProductBtn.click();
            await sleep(500);
            const isModalOpen = await page.$eval('#productModal', el => !el.classList.contains('hidden'));
            console.log('Is Product Modal open?:', isModalOpen);

            if (isModalOpen) {
                console.log('Filling product form...');
                await page.type('#prodName', 'Test Product Alpha');
                await page.type('#prodCategory', 'Hardware');
                await page.type('#prodPrice', '1250');
                await page.type('#prodCost', '800');
                await page.type('#prodStock', '50');
                await page.click('#productForm button[type="submit"]');
                await sleep(1500);
                const toastAfterProduct = await page.$eval('#toastMessage', el => el.innerText).catch(() => '');
                console.log('Toast after saving product:', toastAfterProduct);
            }
        } else {
            console.error('"+ Add Product" button not found!');
        }

        // 3. Test Tab Switching: Click "Create New Order" tab
        console.log('Testing click on "Create New Order" tab...');
        const orderTab = await page.$('button[data-tab="createOrder"]');
        if (orderTab) {
            await orderTab.click();
            await sleep(500);
            const isOrderAccordionVisible = await page.$eval('#accordion-createOrder', el => !el.classList.contains('collapsed'));
            console.log('Is Create Order accordion uncollapsed?:', isOrderAccordionVisible);
        }

        // 4. Test "Confirm & Save Order" button
        console.log('Filling and submitting Create New Order form...');
        await page.type('#custName', 'Babar Azam');
        await page.type('#custPhone', '0321-1122334');
        await page.type('#itemName', 'Cricket Bat');
        await page.type('#itemQuantity', '2');
        await page.type('#itemPrice', '5000');
        await page.click('#confirmSaveOrderBtn');
        await sleep(1500);
        const toastAfterOrder = await page.$eval('#toastMessage', el => el.innerText).catch(() => '');
        console.log('Toast after confirming order:', toastAfterOrder);

        const isInvoiceOpen = await page.$eval('#invoiceModal', el => !el.classList.contains('hidden')).catch(() => false);
        console.log('Is Invoice Modal displayed after order?:', isInvoiceOpen);

        // 5. Test Tab Switching: "Orders History" tab
        console.log('Testing click on "Orders History" tab...');
        const historyTab = await page.$('button[data-tab="orderHistory"]');
        if (historyTab) {
            await historyTab.click();
            await sleep(500);
            const isHistoryOpen = await page.$eval('#accordion-orderHistory', el => !el.classList.contains('collapsed'));
            console.log('Is Orders History accordion open?:', isHistoryOpen);
            const orderRowsCount = await page.$$eval('#orderHistoryTableBody tr', rows => rows.length);
            console.log('Number of rows in Order History table:', orderRowsCount);
        }

        console.log('--- ALL UI AUTOMATION CHECKS FINISHED ---');
    } catch (err) {
        console.error('Fatal automation error:', err);
    } finally {
        await browser.close();
    }
})();
