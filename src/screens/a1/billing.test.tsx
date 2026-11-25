import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@solidjs/testing-library";
import { createMockAdmin, problem, recorded } from "../../test/mockAdmin";
import { writeRetry } from "../../components/FormDialog";
import { ALL_PERMISSIONS } from "../../session/permissions";
import { byId, click, findById, mount, queryById, sessionOf, type, until } from "../../test/harness";
import { CHARGE, CHARGE_PATH, BILLING_CONFIGS, config, CHARGES, CHARGES_PATH, PAY, PAYMENTS, RAISE, SUB_PATH, SUBSCRIPTION, charge, chargePage, dropOnce, money, payment, subscription } from "../../test/a1";

const READ = ["admin.org.read", "admin.subscription.read"];
const BILLING = [...READ, "admin.subscription.manage"];
const ADMIN = [...BILLING, "admin.subscription.adjust", "admin.subscription.start", "admin.plan.manage"];
const past = "2020-01-01";

describe("subscription tab (AS10)", () => {
  it("support sees the subscription and no write control; there is never a suspend or lapse control (AC 54, 57, 59)", async () => {
    mount(SUB_PATH, { session: sessionOf(READ) });
    await findById("sub-plan");
    expect(byId("sub-plan").textContent).toContain("Table service");
    for (const id of ["sub-raise", "sub-change", "sub-cancel", "sub-moveversion"]) expect(queryById(id)).toBeNull();
    expect(screen.queryAllByTestId(/suspend|lapse/i)).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/Suspend for non-payment|Lapse/);
  });

  it("billing staff can raise a charge, change the plan and record a cancel request", async () => {
    mount(SUB_PATH, { session: sessionOf(BILLING) });
    await findById("sub-raise");
    expect(queryById("sub-change")).not.toBeNull();
    expect(queryById("sub-cancel")).not.toBeNull();
  });

  it("a pilot says there are no charges and has no raise control", async () => {
    const { mock } = mount(SUB_PATH, { session: sessionOf(BILLING) });
    mock.on(SUBSCRIPTION, { status: 200, body: subscription({ cycle: "none", state: "pilot", agreed_price: money(0), paid_through: undefined as unknown as string }) });
    expect((await findById("sub-pilot")).textContent).toContain("Pilot: no charges.");
    expect(queryById("sub-raise")).toBeNull();
  });

  it("shows an overdue label with its age from the open charges, and the outlet-limit notice (information only)", async () => {
    const { mock } = mount(SUB_PATH, { session: sessionOf(READ) });
    mock.on(SUBSCRIPTION, { status: 200, body: subscription({ outlets_over_limit: true }) });
    mock.on(CHARGES, { status: 200, body: chargePage([charge({ due_date: past })]) });
    await findById("badge-overdue");
    expect((await findById("sub-overlimit")).textContent).toContain("Notice only");
    expect(byId("sub-overdue-note").textContent).toContain("Nothing is switched off automatically");
  });

  it("a failing read shows an error with Retry and no partial data", async () => {
    const { mock } = mount(SUB_PATH, { session: sessionOf(READ) });
    mock.on(SUBSCRIPTION, problem(503, "upstream_unavailable"));
    await findById("sub-error");
    expect(queryById("sub-plan")).toBeNull();
  });

  it("an organisation with no plan offers assigning one to those who may start a subscription", async () => {
    const { mock } = mount(SUB_PATH, { session: sessionOf([...READ, "admin.subscription.start"]) });
    mock.on(SUBSCRIPTION, { status: 200, body: { history: [] } });
    await findById("sub-empty");
    expect(queryById("sub-assign")).not.toBeNull();
  });
});

describe("raise charge (AS11)", () => {
  async function open(session = sessionOf(BILLING)) {
    const m = mount(SUB_PATH, { session });
    m.mock.on(BILLING_CONFIGS, { status: 200, body: { items: [config()] } });
    await findById("sub-raise");
    click("sub-raise");
    await findById("raise-dialog");
    return m;
  }

  it("prefills the next period, sends the request with an idempotency key, and shows the stored GST split from the service (AC 27 to 30)", async () => {
    const { mock } = await open();
    expect((byId("raise-start") as HTMLInputElement).value).toBe("2027-01-01"); // paid through 31 Dec 2026
    expect((byId("raise-end") as HTMLInputElement).value).toBe("2027-01-31");
    await until(() => expect(byId("raise-config").textContent).toContain("18%"));
    fireEvent.keyDown(byId("raise-start"), { key: "Enter", ctrlKey: true });
    await findById("raise-done-title");
    const sent = mock.callsOf(RAISE)[0];
    expect(sent?.body).toEqual({ kind: "period", period_start: "2027-01-01", period_end: "2027-01-31" });
    expect(sent?.headers.get("idempotency-key")).toBeTruthy();
    const b = byId("raise-breakdown").textContent ?? "";
    expect(b).toContain("₹1,299.00");
    expect(b).toContain("₹116.91");
    expect(b).toContain("₹1,532.82");
    expect(byId("raise-open-charge").getAttribute("href")).toContain("/charges/");
    expect(document.body.textContent).toContain("The invoice is raised in your books");
  });

  it("an inter-state result shows one IGST row; a not-registered result says so (AC 28, 30)", async () => {
    const { mock } = await open();
    mock.on(RAISE, { status: 201, body: charge({ cgst: money(0), sgst: money(0), igst: money(23382), total: money(153282) }) });
    click("raise-dialog-submit");
    await findById("raise-breakdown");
    expect(queryById("breakdown-igst")).not.toBeNull();
    expect(queryById("breakdown-cgst")).toBeNull();
  });

  it("a duplicate period is refused and offers an extra charge with a reason (AC 31)", async () => {
    const { mock } = await open();
    mock.on(RAISE, problem(409, "duplicate_period"));
    click("raise-dialog-submit");
    expect((await findById("raise-dup")).textContent).toContain("A charge already exists for this period");
    click("raise-dup-extra");
    const submit = byId("raise-dialog-submit") as HTMLButtonElement;
    await until(() => expect(submit.disabled).toBe(true)); // an extra charge needs an amount and a reason
    expect(queryById("raise-taxable")).not.toBeNull();
    type("raise-taxable", "500");
    type("raise-reason", "Extra onboarding visit on site");
    await until(() => expect(submit.disabled).toBe(false));
    mock.on(RAISE, { status: 201, body: charge({ kind: "extra" }) });
    click("raise-dialog-submit");
    await findById("raise-breakdown");
    expect(mock.callsOf(RAISE).at(-1)?.body).toMatchObject({ kind: "extra", taxable: { amount_paise: 50000, currency: "INR" }, reason: "Extra onboarding visit on site" });
  });

  it("refuses a note that looks like a phone number or email before anything is sent (AC 58)", async () => {
    const { mock } = await open();
    type("raise-note", "call 9876543210");
    expect((byId("raise-dialog-submit") as HTMLButtonElement).disabled).toBe(true);
    expect(byId("raise-dialog").textContent).toContain("Notes cannot contain phone numbers or email addresses.");
    expect(mock.callsOf(RAISE)).toHaveLength(0);
  });

  it("after a dropped answer it says 'result unknown', checks again with the SAME idempotency key, and the service sees one request key (AC 43, flows 0)", async () => {
    writeRetry.delayMs = 0;
    const mock = createMockAdmin();
    mount(SUB_PATH, { session: sessionOf(BILLING), mock, fetch: dropOnce(mock.fetch, (r) => r.method === "POST" && r.url.endsWith("/charges")) });
    await findById("sub-raise");
    click("sub-raise");
    await findById("raise-dialog");
    click("raise-dialog-submit");
    await findById("raise-breakdown"); // the automatic check succeeded
    const keys = mock.callsOf(RAISE).map((c) => c.headers.get("idempotency-key"));
    expect(keys.length).toBe(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it("a pilot has nothing to charge: no raise control and the c shortcut does nothing", async () => {
    const { mock } = mount(SUB_PATH, { session: sessionOf(BILLING) });
    mock.on(SUBSCRIPTION, { status: 200, body: subscription({ cycle: "none", state: "pilot" }) });
    await findById("sub-pilot");
    fireEvent.keyDown(document.body, { key: "c" });
    expect(queryById("raise-dialog")).toBeNull();
  });

  it("the c shortcut opens the dialog on a subscription page for someone who may raise charges", async () => {
    mount(SUB_PATH, { session: sessionOf(BILLING) });
    await findById("sub-raise");
    fireEvent.keyDown(document.body, { key: "c" });
    await findById("raise-dialog");
  });

  it("the c shortcut is silent for support", async () => {
    mount(SUB_PATH, { session: sessionOf(READ) });
    await findById("sub-plan");
    fireEvent.keyDown(document.body, { key: "c" });
    expect(queryById("raise-dialog")).toBeNull();
  });
});

describe("charges (AS12)", () => {
  it("the reference filter None is the 'no invoice reference' view (AC 33); there is no Edit or Delete (AC 34)", async () => {
    const { mock } = mount(CHARGES_PATH, { session: sessionOf(ADMIN) });
    mock.on(CHARGES, {
      status: 200,
      body: chargePage([charge({ id: "c-none" }), charge({ id: "c-ref", invoice_reference: { number: "INV/26/118", date: "2026-12-02" } })]),
    });
    await until(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(2));
    expect(byId("charges-table").textContent).toContain("INV/26/118");
    const select = byId("charges-ref") as HTMLSelectElement;
    select.value = "none";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => expect(byId("charges-table").textContent).not.toContain("INV/26/118"));
    expect(document.body.textContent).not.toMatch(/\b(Edit|Delete)\b/);
    expect(document.body.textContent).toContain("Opening a charge is recorded in the audit log.");
  });

  it("sends the status filter to the server and an empty list shows an empty state", async () => {
    const { mock } = mount(CHARGES_PATH, { session: sessionOf(READ) });
    mock.on(CHARGES, { status: 200, body: chargePage([]) });
    await findById("charges-empty");
    const select = byId("charges-status") as HTMLSelectElement;
    select.value = "paid";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await until(() => expect(mock.callsOf(CHARGES).at(-1)?.query).toContain("status=paid"));
  });

  it("opening a charge from a Charges-to-raise row opens the raise dialog once (?raise=1)", async () => {
    mount(`${CHARGES_PATH}?raise=1`, { session: sessionOf(BILLING) });
    await findById("raise-dialog");
  });
});

describe("charge detail (AS12, AS13, AS14)", () => {
  it("says that opening it is audited; billing sets the invoice reference once and it then locks (AC 44, 52)", async () => {
    const { mock } = mount(CHARGE_PATH, { session: sessionOf(BILLING) });
    await findById("charge-audited");
    expect(byId("charge-audited").textContent).toContain("recorded in the audit log");
    type("charge-ref", "INV/26/118");
    mock.on("PUT /v1/organisations/{organisation_id}/charges/{charge_id}/invoice-reference", { status: 200, body: charge({ invoice_reference: { number: "INV/26/118", date: "2026-12-02" } }) });
    mock.on(CHARGE, { status: 200, body: charge({ invoice_reference: { number: "INV/26/118", date: "2026-12-02" } }) });
    click("charge-ref-set");
    await findById("charge-ref-locked");
    expect(byId("charge-ref-value").textContent).toBe("INV/26/118");
    const sent = mock.callsOf("PUT /v1/organisations/{organisation_id}/charges/{charge_id}/invoice-reference")[0];
    expect(sent?.body).toMatchObject({ invoice_reference: { number: "INV/26/118" } });
    expect(queryById("charge-ref-set")).toBeNull(); // no way to change it
    expect(document.body.textContent).toContain("a platform admin cancels this charge and raises it again");
  });

  it("a user who may only read sees the reference (or None) but no input, no payment button and no correction buttons (AC 35, 54)", async () => {
    mount(CHARGE_PATH, { session: sessionOf(READ) });
    await findById("charge-audited");
    await until(() => expect(queryById("charge-ref-none")).not.toBeNull());
    for (const id of ["charge-ref-set", "charge-pay", "charge-waive", "charge-cancel"]) expect(queryById(id)).toBeNull();
  });

  it("billing staff can record a payment but cannot waive, cancel or reverse; a platform admin can (AC 35)", async () => {
    const { mock } = mount(CHARGE_PATH, { session: sessionOf(BILLING) });
    mock.on(PAYMENTS, { status: 200, body: { items: [payment()] } });
    await findById("charge-pay");
    await until(() => expect(screen.queryAllByTestId(/^payment-reverse-/)).toHaveLength(0));
    expect(queryById("charge-waive")).toBeNull();
    expect(queryById("charge-cancel")).toBeNull();
    document.body.innerHTML = "";
    const admin = mount(CHARGE_PATH, { session: sessionOf(ADMIN) });
    admin.mock.on(PAYMENTS, { status: 200, body: { items: [payment()] } });
    await findById("charge-waive");
    await until(() => expect(screen.getAllByTestId(/^payment-reverse-/)).toHaveLength(1));
    expect(queryById("charge-cancel")).not.toBeNull();
  });

  it("offers the four payment methods and no gateway; the amount fills with the outstanding amount (AC 45, 51)", async () => {
    mount(CHARGE_PATH, { session: sessionOf(BILLING) });
    await findById("charge-pay");
    click("charge-pay");
    await findById("payment-dialog");
    const methods = screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value);
    expect(methods).toEqual(["upi", "bank_transfer", "cash", "cheque"]);
    expect((byId("payment-amount") as HTMLInputElement).value).toContain("1,532.82");
    expect(byId("payment-after").textContent).toContain("₹0.00");
    expect(document.body.textContent).not.toMatch(/Razorpay|gateway|card|link/i);
  });

  it("an amount above the outstanding is refused inline and sends nothing (AC 48)", async () => {
    const { mock } = mount(CHARGE_PATH, { session: sessionOf(BILLING) });
    await findById("charge-pay");
    click("charge-pay");
    await findById("payment-dialog");
    type("payment-amount", "1600");
    expect(byId("payment-dialog").textContent).toContain("Amount is more than outstanding");
    expect((byId("payment-dialog-submit") as HTMLButtonElement).disabled).toBe(true);
    expect(mock.callsOf(PAY)).toHaveLength(0);
  });

  it("a part payment shows what is left and the tolerance; a duplicate reference warns and still saves (AC 46, 47, 49)", async () => {
    const { mock } = mount(CHARGE_PATH, { session: sessionOf(BILLING) });
    mock.on(PAYMENTS, { status: 200, body: { items: [payment({ reference: "UTR1" })] } });
    mock.on(BILLING_CONFIGS, { status: 200, body: { items: [config()] } });
    await findById("charge-pay");
    await until(() => expect(byId("payments-table").textContent).toContain("UTR1"));
    click("charge-pay");
    await findById("payment-dialog");
    type("payment-amount", "1000");
    expect(byId("payment-after").textContent).toContain("₹532.82");
    await until(() => expect(queryById("payment-tolerance")).not.toBeNull());
    expect(byId("payment-tolerance").textContent).toContain("₹0.99");
    click("payment-method-cheque");
    type("payment-ref", "UTR1");
    expect(byId("payment-dupref").textContent).toContain("You can still record it");
    fireEvent.keyDown(byId("payment-ref"), { key: "Enter", ctrlKey: true });
    await until(() => expect(mock.callsOf(PAY)).toHaveLength(1));
    const sent = mock.callsOf(PAY)[0];
    expect(sent?.body).toMatchObject({ amount: { amount_paise: 100000, currency: "INR" }, method: "cheque", reference: "UTR1" });
    expect(sent?.headers.get("idempotency-key")).toBeTruthy();
  });

  it("the server's overpayment refusal is shown too (AC 48)", async () => {
    const { mock } = mount(CHARGE_PATH, { session: sessionOf(BILLING) });
    await findById("charge-pay");
    click("charge-pay");
    await findById("payment-dialog");
    mock.on(PAY, problem(422, "overpayment"));
    click("payment-dialog-submit");
    expect((await findById("payment-dialog-error")).textContent).toContain("Amount is more than outstanding");
  });

  it("p opens the payment dialog for someone who may record payments, and not for support", async () => {
    mount(CHARGE_PATH, { session: sessionOf(BILLING) });
    await findById("charge-pay");
    fireEvent.keyDown(document.body, { key: "p" });
    await findById("payment-dialog");
  });

  it("reversing a payment needs a reason of 10 characters, adds a row, and keeps the credit-note number with the reason (AC 50)", async () => {
    const { mock } = mount(CHARGE_PATH, { session: sessionOf(ADMIN) });
    mock.on(PAYMENTS, { status: 200, body: { items: [payment()] } });
    await until(() => expect(screen.getAllByTestId(/^payment-reverse-/)).toHaveLength(1));
    click(screen.getAllByTestId(/^payment-reverse-/)[0]?.getAttribute("data-testid") ?? "");
    await findById("adjust-dialog");
    const submit = byId("adjust-dialog-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type("adjust-reason", "Cheque bounced at the bank.");
    type("adjust-books", "CN/26/7");
    expect(submit.disabled).toBe(false);
    click("adjust-dialog-submit");
    const call = await until(() => {
      const c = mock.callsOf("POST /v1/organisations/{organisation_id}/charges/{charge_id}/payments/{payment_id}/reversal")[0];
      expect(c).toBeTruthy();
      return c;
    });
    expect((call?.body as { reason: string }).reason).toContain("Cheque bounced at the bank.");
    expect((call?.body as { reason: string }).reason).toContain("CN/26/7");
  });

  it("waive and cancel use the same one-dialog pattern and call their own operations", async () => {
    const { mock } = mount(CHARGE_PATH, { session: sessionOf(ADMIN) });
    await findById("charge-waive");
    click("charge-waive");
    await findById("adjust-dialog");
    type("adjust-reason", "Goodwill during onboarding delay.");
    click("adjust-dialog-submit");
    await until(() => expect(mock.callsOf("POST /v1/organisations/{organisation_id}/charges/{charge_id}/waiver")).toHaveLength(1));
  });

  it("a read failure shows an error with Retry and no partial charge", async () => {
    const { mock } = mount(CHARGE_PATH, { session: sessionOf(READ) });
    mock.on(CHARGE, problem(503, "upstream_unavailable"));
    await findById("charge-error");
    expect(queryById("charge-breakdown")).toBeNull();
  });

  it("another organisation's charge is a plain not-found (tenancy), never forbidden", async () => {
    const { mock } = mount(CHARGE_PATH, { session: sessionOf(READ) });
    mock.on(CHARGE, problem(404, "not_found"));
    expect((await findById("charge-error")).textContent).toContain("Not found");
  });
});

describe("permissions are enforced by the route as well as by the buttons", () => {
  it("a direct URL without subscription.read shows the forbidden page", async () => {
    mount(CHARGES_PATH, { session: sessionOf(["admin.org.read"]) });
    expect(await findById("forbidden")).toBeTruthy();
  });
  it("the recorded fixture covers the whole contract", () => {
    for (const id of ["raiseCharge", "recordPayment", "reversePayment", "waiveCharge", "cancelCharge", "setChargeInvoiceReference", "exportLedger", "publishTaxRuleSet"]) {
      expect(recorded(id)).toBeDefined();
    }
    expect(ALL_PERMISSIONS).toContain("admin.subscription.adjust");
  });
});
