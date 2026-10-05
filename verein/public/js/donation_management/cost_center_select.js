// Keep the selected document ID separate from the text being searched.
export function cost_center_options(rows, locale = frappe.boot?.lang || "de") {
	const collator = new Intl.Collator(locale.replaceAll("_", "-"), {
		numeric: true,
		sensitivity: "base",
	});
	const labels = rows.map((row) => row.display_name || row.cost_center_name || row.name);
	const counts = new Map();
	for (const label of labels) counts.set(label, (counts.get(label) || 0) + 1);
	return rows
		.map((row, index) => ({
			label:
				counts.get(labels[index]) > 1 ? `${labels[index]} (${row.name})` : labels[index],
			value: row.name,
			search_text: [labels[index], row.cost_center_name, row.cost_center_number, row.name]
				.filter(Boolean)
				.join(" ")
				.toLocaleLowerCase(),
		}))
		.sort((a, b) => collator.compare(a.label, b.label) || collator.compare(a.value, b.value));
}

export function make_cost_center_select({ parent, change }) {
	const control = frappe.ui.form.make_control({
		parent,
		render_input: true,
		df: {
			fieldname: "cost_center",
			label: __("Cost Center"),
			fieldtype: "Autocomplete",
			options: [],
			change,
		},
	});
	const selected_value = () => control.value || "";
	const restore_label = () => control.set_input(selected_value());
	control.get_value = selected_value;
	// Standalone controls have no document from which Frappe can read the old value.
	control.get_model_value = selected_value;
	// Frappe's change/blur handlers must never commit the search text.
	control.get_input_value = selected_value;
	const set_value = control.set_value.bind(control);
	control.set_value = (value) => {
		if (!control.df.options.some((option) => option.value === value) && value !== "") {
			restore_label();
			return Promise.resolve();
		}
		return set_value(value);
	};
	let options_by_value = new Map();
	control.awesomplete.filter = (item, query) =>
		options_by_value.get(item.value)?.search_text.includes(query.trim().toLocaleLowerCase());
	control.awesomplete.item = (item, query, index) => {
		const li = document.createElement("li");
		li.id = `${control.awesomplete.ul.id}_item_${index}`;
		li.setAttribute("role", "option");
		li.setAttribute("aria-selected", "false");
		li.textContent = item.label;
		return li;
	};
	control.awesomplete.sort = false;
	control.set_cost_centers = (rows) => {
		const options = cost_center_options(rows);
		control.df.options = options;
		options_by_value = new Map(options.map((option) => [option.value, option]));
		// Preserve literal labels: the stock set_data translates database names.
		control._data = options;
		control.awesomplete.maxItems = Math.max(options.length, 1);
		control.awesomplete.list = options;
		control.awesomplete.close();
		control.$input.prop("disabled", !options.length);
		control.set_input(options_by_value.has(selected_value()) ? selected_value() : "");
		return options;
	};
	const open = () => {
		if (!control.df.options.length) return;
		control.$input.val("");
		control.awesomplete.evaluate();
	};
	control.$input
		.on("focus.costCenterSelect", open)
		.on("click.costCenterSelect", () => {
			if (!control.awesomplete.opened) open();
		})
		.on("blur.costCenterSelect", restore_label)
		.on("keydown.costCenterSelect", (event) => {
			if (event.key === "Escape") {
				restore_label();
				control.awesomplete.close();
			} else if (event.key === "ArrowDown" && !control.awesomplete.opened) {
				event.preventDefault();
				open();
			}
		})
		.on("awesomplete-selectcomplete.costCenterSelect", (event) => {
			const value = event.originalEvent.text.value;
			const update = control.set_value(value);
			// Also restore the label when the already-selected item was chosen.
			if (value === selected_value()) restore_label();
			return update;
		});
	control.destroy = () => {
		control.$input.off(".costCenterSelect");
		control.awesomplete.destroy();
	};
	return control;
}
