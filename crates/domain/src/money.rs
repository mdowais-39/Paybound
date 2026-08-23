//! Money is ALWAYS integer paise (Part F #4). Never a float, never a decimal,
//! anywhere in the stack. `Paise` is a plain `i64` alias so it maps directly to
//! a Postgres `BIGINT` with zero sqlx friction; the discipline is enforced by
//! the `_paise` naming convention and these helpers, not by wrapper ceremony.

/// Indian paise — 1 rupee = 100 paise. Stored as `BIGINT`.
pub type Paise = i64;

/// The RBI AFA (Additional Factor of Authentication) exemption threshold:
/// recurring debits up to ₹15,000 are AFA-exempt; above it, a human PIN-
/// equivalent step is required. This is a real, regulator-blessed gate — the
/// kernel routes carts above it to `NEEDS_HUMAN` (Phase 2).
pub const AFA_THRESHOLD_PAISE: Paise = 15_000 * 100; // ₹15,000 = 1,500,000 paise

/// Convert whole rupees to paise.
pub const fn rupees_to_paise(rupees: i64) -> Paise {
    rupees * 100
}

/// Format paise as a human ₹ string for narratives / logs (display only —
/// never round-trip money through this).
pub fn format_rupees(paise: Paise) -> String {
    let sign = if paise < 0 { "-" } else { "" };
    let abs = paise.abs();
    format!("₹{}{}.{:02}", sign, abs / 100, abs % 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn afa_threshold_is_fifteen_thousand_rupees() {
        assert_eq!(AFA_THRESHOLD_PAISE, 1_500_000);
        assert_eq!(rupees_to_paise(15_000), AFA_THRESHOLD_PAISE);
    }

    #[test]
    fn formats_rupees_and_paise() {
        assert_eq!(format_rupees(285_000), "₹2850.00");
        assert_eq!(format_rupees(299_950), "₹2999.50");
        assert_eq!(format_rupees(5), "₹0.05");
    }
}
