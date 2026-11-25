import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@solidjs/testing-library";
import { problem } from "../../test/mockAdmin";
import { byId, click, findById, mount, queryById, sessionOf, type, until } from "../../test/harness";
import { APPROVALS, RULESET_ID, approval, ruleSet } from "../../test/a1";
import { addDays, todayIst } from "../../components/dates";

const LIST = "GET /v1/tax-rule-sets";
const ONE = "GET /v1/tax-rule-sets/{rule_set_id}";
const PATCH = "PATCH /v1/tax-rule-sets/{rule_set_id}";
const VALIDATE = "POST /v1/tax-rule-sets/{rule_set_id}/validation";
const SIGN = "POST /v1/tax-rule-sets/{rule_set_id}/signature";
const FILE = "POST /v1/approvals";
const MANAGE = ["admin.org.read", "admin.taxrules.manage"];
const PUBLISH = [...MANAGE, "admin.taxrules.publish", "admin.approval.read", "admin.approval.create"];
const PATH = `/tax-rules/${RULESET_ID}`;

const inforce = ruleSet({ id: "v1-id", version: 1, state: "published", review_status: "reviewed", effective_date: "2026-04-01", organisations_total: 41, organisations_acknowledged: 41, rules: [{ tax_class: "fnb_standard", regime: "regular", specified_premises: false, order_channel: "dine_in", doc_type: "tax_invoice", gst_applies: true, cgst_bp: 200, sgst_bp: 200, igst_bp: 0 }] });
const draft = ruleSet({ state: "draft", effective_date: addDays(todayIst(), 30) });
const signed = (over = {}) =>
  ruleSet({ state: "signed", review_status: "reviewed", content_hash: "sha256:abc", effective_date: addDays(todayIst(), 30), signoff: { reviewer_name: "R. Iyer", signed_on: "2026-11-20", reference_note: "CA review ref C-2026-114" }, ...over });

function open(path: string, session = sessionOf(MANAGE), one = draft) {
  const m = mount(path, { session });
  m.mock.on(ONE, { status: 200, body: one });
  m.mock.on(LIST, { status: 200, body: { items: [one, inforce] } });
  return m;
}

describe("tax rule sets (AS17)", () => {
  it("marks the version in force with text, shows received counts and sign-off, and offers New draft to managers only (AC 76 to 78, 80)", async () => {
    const { mock } = mount("/tax-rules", { session: sessionOf(PUBLISH) });
    mock.on(LIST, { status: 200, body: { items: [signed({ id: "v2-id", version: 2 }), inforce] } });
    mock.on(APPROVALS, { status: 200, body: { items: [approval({ id: "ap-p", kind: "tax_rule_set_publish", subject_id: "v2-id" })] } });
    await until(() => expect(byId("tax-table").textContent).toContain("41 of 41 organisations"));
    expect(byId("tax-inforce-mark").textContent).toBe("In force");
    expect(byId("tax-inforce").textContent).toContain("v1");
    expect(byId("tax-table").textContent).toContain("R. Iyer");
    await until(() => expect(byId("tax-table").textContent).toContain("Pending approval"));
    expect(queryById("tax-new")).not.toBeNull();
    expect(document.body.textContent).toContain("Owners never edit rates.");
    expect(byId("tax-table").querySelectorAll("button")).toHaveLength(0); // no edit control on any row
  });

  it("the route needs admin.taxrules.manage", async () => {
    mount("/tax-rules", { session: sessionOf(["admin.org.read", "admin.subscription.read"]) });
    expect(await findById("forbidden")).toBeTruthy();
  });

  it("a failing read shows an error with Retry and no rows", async () => {
    const { mock } = mount("/tax-rules", { session: sessionOf(MANAGE) });
    mock.on(LIST, problem(503, "upstream_unavailable"));
    await findById("tax-error");
    expect(queryById("tax-table")).toBeNull();
  });
});

describe("draft editor (AS18)", () => {
  it("rates are whole basis points with a 'changed from' mark against the version in force (AC 73)", async () => {
    open(PATH);
    await findById("ruleset-grid");
    const cgst = byId("rule-r0-cgst_bp") as HTMLInputElement;
    expect(cgst.value).toBe("250");
    await until(() => expect(screen.queryAllByTestId(/-changed$/).length).toBeGreaterThan(0)); // draft 250 against 200 in force
    expect(byId("rule-r0-cgst_bp-changed").textContent).toBe("changed from 200");
    type("rule-r0-cgst_bp", "2.5"); // not whole basis points: the draft is blocked until it is fixed
    expect(byId("ruleset-invalid").textContent).toContain("not whole basis points");
    expect((byId("ruleset-validate") as HTMLButtonElement).disabled).toBe(true);
    expect((byId("ruleset-save") as HTMLButtonElement).disabled).toBe(true);
    type("rule-r0-cgst_bp", "300");
    expect(queryById("ruleset-invalid")).toBeNull();
    expect(byId("ruleset-halves-hint").textContent).toContain("row 1");
  });

  it("Save sends the draft with its revision in If-Match, and only a draft is editable", async () => {
    const { mock } = open(PATH);
    await findById("ruleset-grid");
    type("rule-r0-cgst_bp", "300");
    type("rule-r0-sgst_bp", "300");
    click("ruleset-save");
    await until(() => expect(mock.callsOf(PATCH)).toHaveLength(1));
    const sent = mock.callsOf(PATCH)[0];
    expect(sent?.headers.get("if-match")).toBe('"1"');
    expect((sent?.body as { rules: { cgst_bp: number }[] }).rules[0]?.cgst_bp).toBe(300);
    expect(sent?.headers.get("idempotency-key")).toBeTruthy();
  });

  it("a stale revision (412) says someone else changed it", async () => {
    const { mock } = open(PATH);
    await findById("ruleset-grid");
    mock.on(PATCH, problem(412, "precondition_failed"));
    type("rule-r0-cgst_bp", "300");
    click("ruleset-save");
    expect((await findById("ruleset-op-error")).textContent).toContain("Someone else changed this");
  });

  it("Validate lists each check with the reason; Sign stays disabled until every check passes (AC 74)", async () => {
    const { mock } = open(PATH);
    await findById("ruleset-grid");
    expect((byId("ruleset-sign") as HTMLButtonElement).disabled).toBe(true);
    mock.on(VALIDATE, {
      status: 200,
      body: { valid: false, vectors_total: 212, vectors_passed: 210, errors: [{ code: "unequal_halves", detail: "Row 4: 250 vs 300" }] },
    });
    click("ruleset-validate");
    await findById("checklist");
    expect(byId("check-halves").textContent).toContain("Row 4: 250 vs 300");
    expect(byId("check-halves").getAttribute("data-status")).toBe("blocking");
    expect(byId("check-mapping").getAttribute("data-status")).toBe("done");
    expect(byId("check-vectors").textContent).toContain("210 of 212 pass.");
    expect((byId("ruleset-sign") as HTMLButtonElement).disabled).toBe(true);
    mock.on(VALIDATE, { status: 200, body: { valid: true, vectors_total: 212, vectors_passed: 212, errors: [] } });
    click("ruleset-validate");
    await until(() => expect((byId("ruleset-sign") as HTMLButtonElement).disabled).toBe(false));
  });

  it("an edit after validating clears the result, so a changed draft cannot be signed on an old check", async () => {
    const { mock } = open(PATH);
    await findById("ruleset-grid");
    mock.on(VALIDATE, { status: 200, body: { valid: true, vectors_total: 1, vectors_passed: 1, errors: [] } });
    click("ruleset-validate");
    await until(() => expect((byId("ruleset-sign") as HTMLButtonElement).disabled).toBe(false));
    type("rule-r0-igst_bp", "100");
    await until(() => expect((byId("ruleset-sign") as HTMLButtonElement).disabled).toBe(true));
    expect(queryById("checklist")).toBeNull();
  });

  it("someone without admin.taxrules.manage cannot edit: no inputs and no buttons (AC 73)", async () => {
    open(PATH, sessionOf(["admin.org.read", "admin.taxrules.publish"]));
    // The route itself needs manage, so a publisher without it is sent to the forbidden page.
    expect(await findById("forbidden")).toBeTruthy();
  });

  it("a signed version is read-only with a banner and no editing controls (AC 75)", async () => {
    open(PATH, sessionOf(MANAGE), signed());
    await findById("ruleset-readonly");
    expect(screen.queryAllByTestId(/^rule-r\d-/)).toHaveLength(0);
    for (const id of ["ruleset-save", "ruleset-validate", "ruleset-sign", "ruleset-delete"]) expect(queryById(id)).toBeNull();
    expect(byId("ruleset-signoff").textContent).toContain("R. Iyer");
  });

  it("the sign-off needs a reviewer name, a date and a note of 10 characters; it is free text (AC 75; P2D-10)", async () => {
    const { mock } = open(PATH);
    await findById("ruleset-grid");
    mock.on(VALIDATE, { status: 200, body: { valid: true, vectors_total: 1, vectors_passed: 1, errors: [] } });
    click("ruleset-validate");
    await until(() => expect((byId("ruleset-sign") as HTMLButtonElement).disabled).toBe(false));
    click("ruleset-sign");
    await findById("signoff-dialog");
    const submit = byId("signoff-dialog-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type("signoff-name", "R. Iyer");
    type("signoff-note", "short");
    expect(submit.disabled).toBe(true);
    type("signoff-note", "CA review ref C-2026-114");
    expect(submit.disabled).toBe(false);
    expect(document.body.textContent).toContain("After signing, the rules cannot be edited.");
    expect(byId("signoff-dialog").querySelector("input[type=file]")).toBeNull(); // nothing is attached
    click("signoff-dialog-submit");
    await until(() => expect(mock.callsOf(SIGN)).toHaveLength(1));
    expect((mock.callsOf(SIGN)[0]?.body as { signoff: object }).signoff).toMatchObject({ reviewer_name: "R. Iyer", reference_note: "CA review ref C-2026-114" });
  });
});

describe("request publication (AS20)", () => {
  it("files a tax_rule_set_publish approval with the content hash and effective date; nothing is published here (AC 76)", async () => {
    const { mock } = open(PATH, sessionOf(PUBLISH), signed());
    mock.on(APPROVALS, { status: 200, body: { items: [] } });
    await findById("ruleset-publish");
    click("ruleset-publish");
    await findById("publish-dialog");
    expect(byId("publish-lead").textContent).toContain("24 hours");
    expect(byId("publish-dialog").textContent).toContain("A different platform admin must approve this.");
    expect(byId("publish-dialog").textContent).toContain("A late approval means signing a new version");
    expect(byId("publish-dialog").textContent).toContain("Changes from v1");
    const submit = byId("publish-dialog-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    type("publish-ticket", "T-2027");
    type("publish-reason", "Rate change from the council notice.");
    expect(submit.disabled).toBe(false);
    fireEvent.keyDown(byId("publish-ticket"), { key: "Enter", ctrlKey: true });
    await until(() => expect(mock.callsOf(FILE)).toHaveLength(1));
    expect(mock.callsOf(FILE)[0]?.body).toMatchObject({ kind: "tax_rule_set_publish", rule_set_id: RULESET_ID, rule_set_content_hash: "sha256:abc", effective_date: addDays(todayIst(), 30) });
    expect(mock.callsOf("POST /v1/tax-rule-sets/{rule_set_id}/publication")).toHaveLength(0);
  });

  it("under 24 hours ahead it shows the earliest allowed time and offers no submit (AC 76)", async () => {
    const { mock } = open(PATH, sessionOf(PUBLISH), signed({ effective_date: addDays(todayIst(), 1) }));
    mock.on(APPROVALS, { status: 200, body: { items: [] } });
    await findById("ruleset-publish");
    click("ruleset-publish");
    expect((await findById("publish-toosoon")).textContent).toContain("The earliest allowed time is");
    type("publish-ticket", "T-2027");
    type("publish-reason", "Rate change from the council notice.");
    expect((byId("publish-dialog-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("with only one platform admin the refusal says to create a second one at least 7 days ahead (AC 70)", async () => {
    const { mock } = open(PATH, sessionOf(PUBLISH), signed());
    mock.on(APPROVALS, { status: 200, body: { items: [] } });
    await findById("ruleset-publish");
    click("ruleset-publish");
    await findById("publish-dialog");
    type("publish-ticket", "T-2027");
    type("publish-reason", "Rate change from the council notice.");
    mock.on(FILE, problem(409, "second_approver_unavailable"));
    click("publish-dialog-submit");
    expect((await findById("publish-dialog-error")).textContent).toContain("only one platform admin exists");
  });

  it("an unreviewed version is marked for test environments only; the second approver is still required", async () => {
    const { mock } = open(PATH, sessionOf(PUBLISH), signed({ review_status: "unreviewed" }));
    mock.on(APPROVALS, { status: 200, body: { items: [] } });
    await findById("ruleset-publish");
    click("ruleset-publish");
    expect((await findById("publish-unreviewed")).textContent).toContain("test environments only");
    expect(byId("publish-dialog").textContent).toContain("A different platform admin must approve this.");
  });

  it("a request that is already waiting hides the button and shows where it is", async () => {
    const { mock } = open(PATH, sessionOf(PUBLISH), signed());
    mock.on(APPROVALS, { status: 200, body: { items: [approval({ id: "ap-p", kind: "tax_rule_set_publish", subject_id: RULESET_ID })] } });
    await findById("ruleset-waiting");
    expect(queryById("ruleset-publish")).toBeNull();
  });

  it("without admin.taxrules.publish there is no Request publication button", async () => {
    open(PATH, sessionOf(MANAGE), signed());
    await findById("ruleset-readonly");
    expect(queryById("ruleset-publish")).toBeNull();
  });
});
