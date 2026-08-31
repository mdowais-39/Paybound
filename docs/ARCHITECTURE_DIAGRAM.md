# Paybound — Architecture

```mermaid
flowchart TD
    Client["💻 🖥️ 📱<br/><b>Client Devices</b><br/>Web · Mobile"]

    subgraph Backend["Backend"]
        direction TB
        Gateway["🚪<br/><b>Gateway</b><br/>Rust"]
        Agent["🤖<br/><b>Agent API</b><br/>Python"]
        Storefront["🏬<br/><b>Storefront</b><br/>MCP · Rust"]
        Kernel["🔐<br/><b>Kernel</b><br/>Gate"]
        Execution["💳<br/><b>Execution</b><br/>Rust"]
        Temporal["⏱️<br/><b>Temporal</b>"]
        PG[("🗄️<br/><b>PostgreSQL</b>")]
    end

    Razorpay["🏦<br/><b>Razorpay</b>"]

    Client <-->|"①"| Gateway
    Client <-->|"②"| Agent
    Agent <-->|"③"| Storefront
    Storefront <-->|"④"| Kernel
    Kernel <-->|"⑤"| Execution
    Kernel <-->|"⑥"| Temporal
    Execution <-->|"⑦"| Razorpay
    Gateway <-->|"⑧"| PG
    Storefront <-->|"⑧"| PG
    Execution <-->|"⑧"| PG

    classDef box fill:#d6e8f7,stroke:#2c3e50,stroke-width:1.2px,color:#000
    classDef ext fill:#f2f2f2,stroke:#2c3e50,stroke-width:1.2px,color:#000

    class Gateway,Agent,Storefront,Kernel,Execution,Temporal,PG box
    class Client,Razorpay ext
    style Backend fill:#ffffff,stroke:#2c3e50,stroke-width:1.2px
```

① mandate + revoke + audit · ② goal · ③ MCP tool calls · ④ checkout →
evaluate · ⑤ approved → charge · ⑥ &gt;₹15,000 pause/resume · ⑦ payment link +
webhook · ⑧ persist + audit chain
