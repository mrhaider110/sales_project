const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log(`[CONSOLE ${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', err => console.log(`[PAGE ERROR]: ${err.message}`));

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });

    // Login
    await page.type('#loginUsername', 'admin');
    await page.type('#loginPassword', 'admin123');
    await page.click('#loginForm button[type="submit"]');
    await new Promise(r => setTimeout(r, 1000));

    // Try Order Form Submit
    console.log('Testing Create Order Submit directly...');
    await page.evaluate(() => {
        document.getElementById('custName').value = 'Test Customer';
        document.getElementById('itemName').value = 'Wireless Mouse';
        document.getElementById('itemQuantity').value = '1';
        document.getElementById('itemPrice').value = '1500';
    });
    
    // Listen for response
    page.on('response', async res => {
        if (res.url().includes('/api/orders')) {
            console.log(`[RESPONSE /api/orders]: Status ${res.status()}`);
            try {
                const json = await res.json();
                console.log('[RESPONSE JSON]:', json);
            } catch(e) {}
        }
    });

    console.log('Clicking confirmSaveOrderBtn...');
    await page.click('#confirmSaveOrderBtn');
    await new Promise(r => setTimeout(r, 2000));

    const isInvoiceHidden = await page.$eval('#invoiceModal', el => el.classList.contains('hidden'));
    console.log('Is invoiceModal hidden?:', isInvoiceHidden);
    const invoiceText = await page.$eval('#printableInvoice', el => el.innerText).catch(() => '');
    console.log('Invoice text preview:', invoiceText.slice(0, 100));

    await browser.close();
})();
