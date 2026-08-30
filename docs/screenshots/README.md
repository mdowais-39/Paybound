# Screenshots

The main [`README`](../../README.md) references three product screenshots from
this folder. Drop the PNGs in at the exact filenames below and they render
automatically.

To capture them: start the stack (`bash scripts/run_backend.sh` +
`cd frontend && npm run dev`), open http://localhost:5173, and grab each view.

| File | Page | What to show |
|---|---|---|
| `mandate-console.png` | `/mandate` | The Consent & Mandate Console — the "Grant New Spending Mandate" form (budget, per-txn cap, categories, TTL) with the live **Authority Contract Preview** card on the right, and the "Mandate Kernel Guarantee: purchases exceeding ₹15,000 require AFA" note. |
| `shop-console.png` | `/shop` | A cart mid-flow: the 6-node **execution pipeline** stepper (Pre-Checks → Intent Parsing → Catalog Match → Cart Composer → Kernel Gate → Settlement Rails) with a **CHOOSE** list of real product options, or an **AUTHORIZED** outcome showing the real Razorpay payment link. |
| `audit-trail.png` | `/audit` | An expanded audit entry showing the **PRODUCTS** section (real title · category · price), the plain-language narrative, the **hash-chain link**, the mandate authority, and the green **"Session chain verified"** badge. |

Recommended: 1600px wide, PNG, cropped to the content (no browser chrome).
