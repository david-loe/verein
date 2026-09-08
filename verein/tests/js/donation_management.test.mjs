import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import moment from "../../../../frappe/node_modules/moment/moment.js";

globalThis.__ = (text) => text;
globalThis.moment = moment;
globalThis.flt = (value) => Number(value) || 0;
const { DonationFilters } = await import(
  "../../public/js/donation_management/filters.js"
);
const { DonationTableControls } = await import(
  "../../public/js/donation_management/table_controls.js"
);
const { CostCenterBookingsPage } = await import(
  "../../public/js/donation_management/cost_center_bookings.js"
);
const { DonorsPage } = await import(
  "../../public/js/donation_management/donors.js"
);
const { CostCenterOverviewPage } = await import(
  "../../public/js/donation_management/cost_center_overview.js"
);
const { create_page_runtime } = await import(
  "../../public/js/donation_management/runtime.js"
);

const KEY = "verein.donation_management.cost_center_filters";
const costCenters = [
  { name: "a1", company: "A", display_name: "First" },
  { name: "a2", company: "A", display_name: "Second" },
  { name: "b1", company: "B", display_name: "Third" },
];
function element() {
  return {
    length: 0,
    visible: true,
    appendTo() {
      return this;
    },
    append() {
      return this;
    },
    toggle(value) {
      this.visible = value;
      return this;
    },
    toggleClass() {
      return this;
    },
    off() {
      return this;
    },
    on() {
      return this;
    },
    find() {
      return element();
    },
    each() {
      return this;
    },
    remove() {},
    prop() {
      return this;
    },
    hide() {
      return this;
    },
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  const storage = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.$ = () => element();
  globalThis.frappe = {
    datetime: {
      now_date: () => "2026-09-08",
      add_months: (date, months) =>
        moment(date).add(months, "months").format("YYYY-MM-DD"),
    },
    utils: {
      escape_html: (text) =>
        text.replaceAll("&", "&amp;").replaceAll("<", "&lt;"),
      icon: () => "",
    },
    ui: {
      form: {
        make_control({ df }) {
          return {
            df,
            $wrapper: element(),
            value: "",
            refresh() {},
            get_value() {
              return this.value;
            },
            async set_value(value) {
              if (this.value === value) return;
              this.value = value;
              await df.change();
            },
          };
        },
      },
    },
    call: async () => ({ message: costCenters }),
    msgprint: (message) => {
      throw new Error(message);
    },
  };
});
function filters() {
  const events = [];
  let invalidations = 0;
  const component = new DonationFilters({
    on_invalidate: () => invalidations++,
    on_change: (values, changed) => events.push({ values, changed }),
  });
  component.mount(element());
  return { component, events, invalidations: () => invalidations };
}

test("restores a shared selection without intermediate requests", async () => {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      company: "A",
      cost_center: "b1",
      period: "Custom",
      from_date: "2025-01-04",
      to_date: "2025-08-09",
    })
  );
  const { component, events, invalidations } = filters();
  assert.equal(await component.refresh(), true);
  assert.deepEqual(component.get_values(), {
    company: "B",
    cost_center: "b1",
    period: "Custom",
    from_date: "2025-01-04",
    to_date: "2025-08-09",
  });
  assert.equal(events.length, 0);
  assert.equal(invalidations(), 0);
});

test("invalid selections and incomplete Custom dates use the six-month default", async () => {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({ company: "gone", cost_center: "gone", period: "Custom" })
  );
  const { component } = filters();
  await component.refresh();
  assert.deepEqual(component.get_values(), {
    company: "A",
    cost_center: "a1",
    period: "Last Half Year",
    from_date: "2026-03-01",
    to_date: "2026-09-08",
  });
});

test("company and period changes each produce one coherent notification", async () => {
  const { component, events, invalidations } = filters();
  await component.refresh();
  await component.companyControl.set_value("B");
  assert.equal(events.length, 1);
  assert.equal(events[0].values.cost_center, "b1");
  assert.deepEqual(events[0].changed, ["company", "cost_center"]);
  await component.dateRangeControl.set_value("Last Year");
  assert.equal(events.length, 2);
  assert.equal(events[1].values.from_date, "2025-09-01");
  assert.equal(invalidations(), 2);
});

test("date edits invalidate immediately and debounce one request", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { component, events, invalidations } = filters();
  await component.refresh();
  await component.fromDateControl.set_value("2026-01-10");
  await component.toDateControl.set_value("2026-08-20");
  assert.equal(invalidations(), 2);
  assert.equal(events.length, 0);
  t.mock.timers.tick(299);
  assert.equal(events.length, 0);
  t.mock.timers.tick(1);
  assert.equal(events.length, 1);
  assert.equal(events[0].values.period, "Custom");
  assert.equal(events[0].values.to_date, "2026-08-20");
});

test("storage failures, single company and revoked access remain usable", async () => {
  globalThis.sessionStorage = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("blocked");
    },
  };
  frappe.call = async () => ({ message: costCenters.slice(0, 2) });
  const { component } = filters();
  await component.refresh();
  assert.equal(component.companyControl.$wrapper.visible, false);
  await component.costCenterControl.set_value("a2");
  frappe.call = async () => ({ message: [] });
  assert.equal(await component.refresh(), false);
  assert.equal(component.get_values().cost_center, null);
});

test("a newer filter change supersedes an outstanding options refresh", async () => {
  const { component } = filters();
  await component.refresh();
  const response = deferred();
  frappe.call = () => response.promise;
  const refresh = component.refresh();
  await component.costCenterControl.set_value("a2");
  response.resolve({ message: costCenters });
  assert.equal(await refresh, null);
  assert.equal(component.get_values().cost_center, "a2");
});

test("destroy cancels pending filter notifications", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { component, events } = filters();
  await component.refresh();
  await component.fromDateControl.set_value("2026-01-01");
  component.destroy();
  t.mock.timers.tick(300);
  assert.equal(events.length, 0);
});

test("column edits debounce, while sorting cancels the timer and cycles to default", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events = [];
  let invalidations = 0;
  const table = new DonationTableControls({
    shell: element(),
    id: "test",
    fields: { search: { type: "Data" } },
    on_invalidate: () => invalidations++,
    on_change: (value) => events.push(value),
  });
  table.set_column_filter("search", "a", 300);
  table.set_column_filter("search", "ab", 300);
  assert.equal(invalidations, 2);
  assert.equal(events.length, 0);
  await table.update_sort("amount");
  assert.deepEqual(events[0], {
    filters: { search: "ab" },
    sort: { field: "amount", direction: "asc" },
  });
  t.mock.timers.tick(300);
  assert.equal(events.length, 1);
  await table.update_sort("amount");
  assert.equal(events[1].sort.direction, "desc");
  await table.update_sort("amount");
  assert.equal(events[2].sort, null);
});

for (const [Page, load, generation, resultField] of [
  [
    CostCenterBookingsPage,
    "load_bookings",
    "bookingRequestGeneration",
    "entries",
  ],
  [DonorsPage, "load_donors", "donorRequestGeneration", "donors"],
  [
    CostCenterOverviewPage,
    "load_dashboard",
    "dashboardRequestGeneration",
    "data",
  ],
]) {
  test(`${Page.name} ignores a late response after filters change`, async () => {
    const old = deferred();
    const fresh = deferred();
    let calls = 0;
    let renders = 0;
    frappe.call = () => (++calls === 1 ? old.promise : fresh.promise);
    const page = Object.create(Page.prototype);
    Object.assign(page, {
      [generation]: 0,
      entries: [],
      donors: [],
      expandedDonors: new Set(),
      donorBookings: {},
      filters: {
        costCenterControl: { get_value: () => "a1" },
        fromDateControl: { get_value: () => "2026-01-01" },
        toDateControl: { get_value: () => "2026-09-08" },
        cancel_pending() {},
      },
      tableControls: { filters: {}, sort: null, cancel_pending() {} },
      loadMore: { $row: element(), $button: element(), set_loading() {} },
      sync_booking_filter_context() {},
      show_loading() {},
      render() {
        renders++;
      },
    });
    const first = page[load](true);
    // Invalidate during the debounce interval, before issuing the next request.
    page[generation]++;
    old.resolve({ message: { [resultField]: [{ name: "old" }] } });
    await first;
    assert.equal(renders, 0);
    const second = page[load](true);
    fresh.resolve({ message: { [resultField]: [{ name: "new" }] } });
    await second;
    assert.equal(renders, 1);
  });
}

test("runtime coalesces first load/refresh and cleans up only detached wrappers", async () => {
  let observerCallback;
  let creates = 0;
  let refreshes = 0;
  let destroys = 0;
  globalThis.document = { body: {} };
  globalThis.MutationObserver = class {
    constructor(callback) {
      observerCallback = callback;
    }
    observe() {}
    disconnect() {}
  };
  const pending = deferred();
  class Page {
    constructor() {
      creates++;
    }
    async refresh() {
      refreshes++;
      await pending.promise;
    }
    destroy() {
      destroys++;
    }
  }
  const refresh = create_page_runtime({ test: { Page, property: "testPage" } });
  const wrapper = { isConnected: true };
  const first = refresh("test", wrapper);
  assert.equal(refresh("test", wrapper), first);
  await Promise.resolve();
  assert.equal(creates, 1);
  assert.equal(refreshes, 1);
  observerCallback();
  assert.equal(destroys, 0);
  pending.resolve();
  await first;
  await refresh("test", wrapper);
  assert.equal(refreshes, 2);
  wrapper.isConnected = false;
  observerCallback();
  assert.equal(destroys, 1);
});

test("all page adapters share one asset request, including simultaneous first loads", async () => {
  const assets = deferred();
  const requests = [];
  const refreshes = [];
  globalThis.document = {
    styleSheets: [
      { href: "/assets/verein/dist/css/donation_management.bundle.hash.css" },
    ],
  };
  globalThis.verein = { donation_management: {} };
  frappe.provide = () => {};
  frappe.pages = {
    donors: {},
    "cost-center-bookings": {},
    "cost-center-overview": {},
  };
  frappe.require = (files) => {
    requests.push(files);
    return assets.promise;
  };
  for (const name of [
    "donors",
    "cost_center_bookings",
    "cost_center_overview",
  ]) {
    vm.runInThisContext(
      await readFile(
        new URL(
          `../../donation_management/page/${name}/${name}.js`,
          import.meta.url
        ),
        "utf8"
      )
    );
  }
  const pending = Object.entries(frappe.pages).map(([name, page]) =>
    page.on_page_load({ name })
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], [
    "donation_management.bundle.js",
    "donation_management.bundle.css",
  ]);
  globalThis.verein.donation_management.refresh_page = (name) =>
    refreshes.push(name);
  assets.resolve();
  await Promise.all(pending);
  assert.equal(refreshes.length, 3);
});

test("missing bundle styles show one loading error and do not mount pages", async () => {
  globalThis.document = { styleSheets: [] };
  globalThis.verein = {
    donation_management: {
      refresh_page() {
        throw Error("must not mount");
      },
    },
  };
  frappe.provide = () => {};
  frappe.pages = { donors: {} };
  frappe.require = async () => {};
  const errors = [];
  frappe.msgprint = (message) => errors.push(message);
  vm.runInThisContext(
    await readFile(
      new URL(
        "../../donation_management/page/donors/donors.js",
        import.meta.url
      ),
      "utf8"
    )
  );
  await Promise.all([
    frappe.pages.donors.on_page_load({}),
    frappe.pages.donors.refresh({}),
  ]);
  assert.deepEqual(errors, [
    "Donation Management could not be loaded. Please reload the page.",
  ]);
});
