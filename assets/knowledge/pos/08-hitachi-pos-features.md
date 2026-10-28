# Hitachi POS App Features (Kopi Tepi Demo)

This guide describes the features available in the Hitachi POS demo app for the Kopi Tepi outlet.

## User roles
- Owner: can use every feature, including the sales and profit Dashboard, and can ask NEXUS about profit.
- Cashier: can create transactions and ask NEXUS operational questions, but cannot see profit or the Dashboard.
- On the demo page, the role is chosen with the **Signed in as Owner / Cashier** buttons at the top.

## Cashier page
Shows the menu, search, category tabs, the order cart, payment method (Cash or QRIS), and the Pay button. See the SOP for transactions and payments for the full steps.

## Dashboard page (owner only)
- Choose a date range: **Today**, **7 days**, **30 days**, or **Custom**.
- Custom lets you pick a **From** and **To** date, up to 92 days. For a single day, pick the same date for both, or tap **Single day**. Dates in the future cannot be chosen.
- Clicking a bar in the daily chart opens that single day.
- The selected range is kept in the page address, so the view can be bookmarked or shared.
- Summary cards: Sales, COGS, Profit with margin, Transactions, and Average per transaction. Each card shows the change compared with the previous period of the same length (for a single day, the day before).
- Daily sales and profit chart: hover over a bar to see that day's figures, or open **View as table**.
- Top products: the seven products with the most units sold.
- Payment methods: the share of sales paid by Cash, QRIS, and Card.
- Missing COGS warning: shown when products without COGS were sold, so profit does not include their cost yet.
- The **Ask NEXUS** button on the Dashboard asks NEXUS about profit for the range on screen.

## Cashier session
The top bar shows how many transactions and how much revenue were created in the current browser session. Demo transactions are not sent to the server, so reports and the Dashboard do not change.

## Receipt
After a successful payment, the receipt shows the order number (KT followed by four digits), items, subtotal, VAT, total, and change.

## Admin Studio
Admin Studio (the /login page) is where administrators manage NEXUS: upload knowledge documents (PDF, DOCX, MD, TXT), write FAQs, set the persona and avatar, and review unanswered questions and user feedback.
