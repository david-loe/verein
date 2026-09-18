import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const { DonationNotificationsPage, valid_notification_rules } = await import(
  "../../public/js/donation_management/notifications.js"
);

class Element {
  constructor() {
    this.handlers = {};
    this.properties = {};
    this.content = "";
    this.children = {};
  }
  toggle(value) {
    this.visible = value;
    return this;
  }
  toggleClass() {
    return this;
  }
  appendTo() {
    return this;
  }
  on(event, selector, callback) {
    this.handlers[selector] = callback;
    return this;
  }
  prop(name, value) {
    if (value === undefined) return this.properties[name];
    this.properties[name] = value;
    return this;
  }
  html(value) {
    this.content = value;
    return this;
  }
  find(selector) {
    return (this.children[selector] ||= new Element());
  }
  off() {
    return this;
  }
  remove() {
    return this;
  }
}

const settings = {
  email: "user@example.com",
  timezone: "Europe/Berlin",
  cost_centers: [
    {
      name: "c1",
      display_name: "School <A>",
      company: "Example",
      currency: "EUR",
    },
  ],
  rules: [],
};
let calls;
let messages;
beforeEach(() => {
  calls = [];
  messages = [];
  globalThis.__ = (text, args = []) =>
    text.replace(/\{(\d+)\}/g, (_, i) => args[i]);
  globalThis.$ = () => new Element();
  globalThis.frappe = {
    ui: {
      make_app_page: () => ({
        main: {},
        set_primary_action: () => new Element(),
        clear_indicator() {},
        set_indicator() {},
      }),
      form: {
        make_control({ df }) {
          return {
            df,
            $wrapper: new Element(),
            $input: new Element(),
            value: "",
            refresh() {},
            set_input(value) {
              this.value = value;
            },
            get_value() {
              return this.value;
            },
            async set_value(value) {
              this.value = value;
              await df.change();
            },
          };
        },
      },
    },
    utils: {
      icon: (name) =>
        `<svg class="icon"><use href="#icon-${name}"></use></svg>`,
      escape_html: (value) =>
        value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;"),
    },
    call: async (request) => {
      calls.push(request);
      return { message: structuredClone(settings) };
    },
    msgprint: (message) => messages.push(message),
    show_alert() {},
  };
});

test("empty settings show selectors first without an extra heading", async () => {
  const page = new DonationNotificationsPage({});
  await page.refresh();
  assert.match(page.$root.content, /No notifications configured/);
  assert.match(page.$root.content, /user@example.com/);
  assert.doesNotMatch(page.$root.content, /<h2>/);
  assert.ok(
    page.$root.content.indexOf("notification-picker") <
      page.$root.content.indexOf("notification-recipient")
  );
  assert.match(page.$root.content, /notification-recipient/);
  assert.doesNotMatch(
    page.$root.content,
    /08:00|future bookings|Group cost centers/
  );
  assert.equal(page.$save.properties.disabled, true);
});

test("cost center can be added only once and removed again", async () => {
  const page = new DonationNotificationsPage({});
  await page.refresh();
  page.add();
  page.add();
  assert.equal(page.rules.length, 1);
  assert.equal(page.rules[0].notify_new_donor, 0);
  assert.equal(page.rules[0].notify_large_donation, 0);
  assert.match(page.$root.content, /School &lt;A&gt;/);
  assert.equal(page.dirty, true);
  page.$root.handlers["[data-remove]"]({
    currentTarget: { dataset: { remove: "0" } },
  });
  assert.equal(page.rules.length, 0);
});

test("threshold is visible and required only when enabled", async () => {
  const page = new DonationNotificationsPage({});
  await page.refresh();
  const row = { cost_center: "c1", notify_large_donation: 0 };
  assert.match(page.render_card(row, 0), /notification-threshold" hidden/);
  const enabled = page.render_card(
    { ...row, notify_large_donation: 1, threshold: 100 },
    0
  );
  assert.doesNotMatch(enabled, /notification-threshold" hidden/);
  assert.match(enabled, /Threshold \(EUR\)/);
  assert.match(enabled, /required/);
});

test("invalid enabled thresholds prevent saving", async () => {
  const page = new DonationNotificationsPage({});
  await page.refresh();
  page.rules = [{ cost_center: "c1", notify_large_donation: 1, threshold: "" }];
  page.set_dirty();
  await page.save();
  assert.equal(calls.length, 1);
  assert.match(messages[0], /positive threshold/);
  for (const threshold of [0, -1, Infinity, "invalid"])
    assert.equal(
      valid_notification_rules([{ notify_large_donation: 1, threshold }]),
      false
    );
  assert.equal(
    valid_notification_rules([{ notify_large_donation: 0, threshold: "" }]),
    true
  );
});

test("successful save uses server settings and clears unsaved state", async () => {
  const page = new DonationNotificationsPage({});
  await page.refresh();
  page.rules = [
    { cost_center: "c1", notify_new_donor: 1, notify_large_donation: 0 },
  ];
  page.set_dirty();
  frappe.call = async (request) => {
    calls.push(request);
    return { message: { ...settings, rules: request.args.settings.rules } };
  };
  await page.save();
  assert.match(calls[1].method, /save_notification_settings$/);
  assert.equal(page.dirty, false);
  assert.equal(page.rules[0].notify_new_donor, 1);
  assert.equal(page.$save.properties.disabled, true);
});

test("failed save preserves edits and allows retry", async () => {
  const page = new DonationNotificationsPage({});
  await page.refresh();
  page.rules = [{ cost_center: "c1", notify_new_donor: 1 }];
  page.set_dirty();
  frappe.call = async () => {
    throw new Error("network failure");
  };
  await page.save();
  assert.equal(page.dirty, true);
  assert.equal(page.rules.length, 1);
  assert.equal(page.$save.properties.disabled, false);
});

test("refresh does not overwrite unsaved edits or late responses", async () => {
  const page = new DonationNotificationsPage({});
  await page.refresh();
  let resolve;
  frappe.call = () =>
    new Promise((done) => {
      resolve = done;
    });
  const refresh = page.refresh();
  page.rules = [{ cost_center: "c1", notify_new_donor: 1 }];
  page.set_dirty();
  resolve({ message: structuredClone(settings) });
  await refresh;
  await page.refresh();
  assert.equal(page.rules.length, 1);
  assert.equal(page.dirty, true);
});

test("inline picker follows company and excludes configured cost centers", async () => {
  const page = new DonationNotificationsPage({});
  page.apply_settings({
    ...structuredClone(settings),
    cost_centers: [
      ...settings.cost_centers,
      { name: "c2", company: "Second", display_name: "Other", currency: "EUR" },
      {
        name: "c3",
        company: "Second",
        display_name: "Another",
        currency: "EUR",
      },
    ],
  });
  assert.equal(page.$root.find(".add-notification").properties.disabled, false);
  assert.equal(page.costCenterControl.get_value(), "c1");
  await page.companyControl.set_value("Second");
  assert.equal(page.costCenterControl.get_value(), "c2");
  assert.deepEqual(
    page.costCenterControl.df.options.map((row) => row.value),
    ["c2", "c3"]
  );
  await page.costCenterControl.set_value("c3");
  page.add();
  assert.equal(page.rules[0].cost_center, "c3");
  assert.equal(page.companyControl.get_value(), "Second");
  assert.equal(page.costCenterControl.get_value(), "c2");
  page.add();
  assert.equal(page.costCenterControl.get_value(), "");
  assert.equal(page.costCenterControl.$input.properties.disabled, true);
  await page.companyControl.set_value("Example");
  assert.equal(page.costCenterControl.get_value(), "c1");
  assert.equal(page.costCenterControl.$input.properties.disabled, false);
});
