import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  cost_center_options,
  make_cost_center_select,
} from "../../public/js/donation_management/cost_center_select.js";

// Exercise Frappe's real standalone-control change detection, including blur/change
// events; a mock comparing only control.value would conceal duplicate requests.
const framework = {
  ui: { form: {} },
  run_serially: (steps) =>
    steps.reduce((promise, step) => promise.then(step), Promise.resolve()),
};
vm.runInNewContext(
  readFileSync(
    new URL(
      "../../../../frappe/frappe/public/js/frappe/form/controls/base_control.js",
      import.meta.url
    ),
    "utf8"
  ),
  { frappe: framework }
);
const baseControl = framework.ui.form.Control.prototype;

test("visible numbers sort naturally, including leading zeros and unnumbered names", () => {
  const labels = [
    "100 – Projekt",
    "10 – Projekt",
    "2 – Zebra",
    "002 – Alpha",
    "Zelt",
    "Äpfel",
  ];
  const rows = labels.map((display_name) => ({
    name: display_name,
    display_name,
  }));
  assert.deepEqual(
    cost_center_options(rows, "de").map((row) => row.label),
    [
      "002 – Alpha",
      "2 – Zebra",
      "10 – Projekt",
      "100 – Projekt",
      "Äpfel",
      "Zelt",
    ]
  );
  assert.deepEqual(
    rows.map((row) => row.display_name),
    labels
  );
  assert.deepEqual(
    cost_center_options(
      [
        { name: "a", display_name: "Alpha", cost_center_number: "100" },
        { name: "b", display_name: "Beta", cost_center_number: "2" },
      ],
      "de"
    ).map((row) => row.value),
    ["a", "b"]
  );
});

test("duplicate labels retain distinct document IDs and readable labels", () => {
  const options = cost_center_options(
    [
      { name: "id2", cost_center_name: "Projekt" },
      { name: "id1", cost_center_name: "Projekt" },
      { name: "Fallback" },
    ],
    "de"
  );
  assert.deepEqual(
    options.map(({ value, label }) => [value, label]),
    [
      ["Fallback", "Fallback"],
      ["id1", "Projekt (id1)"],
      ["id2", "Projekt (id2)"],
    ]
  );
});

function picker() {
  const handlers = {};
  const input = {
    text: "",
    disabled: false,
    on(name, callback) {
      handlers[name] = callback;
      return this;
    },
    off() {},
    prop(name, value) {
      this[name] = value;
      return this;
    },
    val(value) {
      if (value === undefined) return this.text;
      this.text = value;
      return this;
    },
  };
  const changes = [];
  globalThis.__ = (text) => text;
  globalThis.frappe = {
    boot: { lang: "de" },
    ui: {
      form: {
        make_control({ df }) {
          return {
            df,
            value: "",
            $input: input,
            awesomplete: {
              ul: { id: "list" },
              evaluate() {
                this.opened = true;
              },
              close() {
                this.opened = false;
              },
              destroy() {
                this.destroyed = true;
              },
            },
            set_input(value) {
              this.value = value;
              input.val(
                this._data?.find((row) => row.value === value)?.label || value
              );
            },
            get_model_value: baseControl.get_model_value,
            set_value: baseControl.set_value,
            validate_and_set_in_model: baseControl.validate_and_set_in_model,
            set_model_value: baseControl.set_model_value,
            validate: (value) => value,
          };
        },
      },
    },
  };
  const control = make_cost_center_select({
    parent: {},
    change: () => changes.push(control.get_value()),
  });
  return {
    control,
    input,
    changes,
    fire: (name, event) => handlers[`${name}.costCenterSelect`](event),
  };
}

test("searching, no matches, blur and Escape preserve the committed selection", async () => {
  const { control, input, changes, fire } = picker();
  control.set_cost_centers([
    { name: "a", display_name: "Schule <A>", cost_center_number: "123" },
    { name: "b", display_name: "Büro", cost_center_number: "456" },
  ]);
  await control.set_value("a");
  fire("focus");
  assert.equal(input.val(), "");
  input.val("BÜ");
  assert.equal(control.awesomplete.filter({ value: "b" }, input.val()), true);
  assert.equal(control.awesomplete.filter({ value: "a" }, " 23 "), true);
  assert.equal(control.awesomplete.filter({ value: "a" }, "nothing"), false);
  assert.equal(control.get_input_value(), "a");
  assert.equal(control.get_value(), "a");
  await control.validate_and_set_in_model(control.get_input_value());
  assert.deepEqual(changes, ["a"]);
  fire("blur");
  assert.equal(input.val(), "Schule <A>");
  fire("focus");
  input.val("nothing");
  fire("keydown", { key: "Escape" });
  assert.equal(control.awesomplete.opened, false);
  assert.equal(input.val(), "Schule <A>");
  await control.set_value("unshared");
  assert.deepEqual(changes, ["a"]);
  await fire("awesomplete-selectcomplete", {
    originalEvent: { text: { value: "b" } },
  });
  assert.equal(control.get_value(), "b");
  assert.equal(input.val(), "Büro");
  assert.deepEqual(changes, ["a", "b"]);
});

test("all options are available and removing access clears and disables the picker", async () => {
  const { control, input, changes } = picker();
  const rows = Array.from({ length: 150 }, (_, i) => ({
    name: `id${i}`,
    display_name: `${i} – Projekt`,
  }));
  control.set_cost_centers(rows);
  assert.equal(control.awesomplete.maxItems, 150);
  await control.set_value("id149");
  control.set_cost_centers(rows.slice(100));
  assert.equal(control.get_value(), "id149");
  control.set_cost_centers([]);
  assert.equal(control.get_value(), "");
  assert.equal(input.disabled, true);
  assert.deepEqual(changes, ["id149"]);
  control.destroy();
  assert.equal(control.awesomplete.destroyed, true);
});
