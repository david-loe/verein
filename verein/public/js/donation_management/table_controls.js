import { escape_html, escape_attr, get_icon } from "./presentation.js";

export class DonationTableControls {
	constructor({ shell, id, fields, on_invalidate, on_change }) {
		this.$tableShell = shell;
		this.id = id;
		this.fields = fields;
		this.on_invalidate = on_invalidate;
		this.on_change = on_change;
		this.filters = Object.fromEntries(Object.keys(fields).map((field) => [field, ""]));
		this.openColumnFilters = new Set();
		this.sort = null;
		this.optionSignatures = {};
		this.bind_column_filters();
	}

	async notify() {
		this.cancel_pending();
		if (this.destroyed) return;
		try {
			await this.on_change({
				filters: { ...this.filters },
				sort: this.sort && { ...this.sort },
			});
		} catch (error) {
			frappe.msgprint(error.message || __("Data could not be loaded."));
		}
	}

	set_options(field, options, emptyLabel) {
		const $select = this.$tableShell.find(`select[data-filter-field="${field}"]`);
		if (!$select.length) return;
		const signature = JSON.stringify([options, emptyLabel]);
		if (this.optionSignatures[field] === signature) return;
		this.optionSignatures[field] = signature;
		$select.html(
			`<option value="">${escape_html(emptyLabel)}</option>` +
				options
					.map(
						(row) =>
							`<option value="${escape_attr(row.value)}">${escape_html(
								row.label
							)}</option>`
					)
					.join("")
		);
	}

	cancel_pending() {
		clearTimeout(this.columnFilterTimeout);
		this.columnFilterTimeout = null;
		this.pendingColumnFilterField = null;
	}

	destroy() {
		this.destroyed = true;
		this.cancel_pending();
		this.$tableShell.off(".donationControls");
	}
	render_column_header(sortField, label, filterField) {
		const id = `${this.id}-filter-${filterField}`;
		const filterLabel = escape_attr(__("Filter {0}", [label]));
		const input =
			this.fields[filterField]?.type === "Select"
				? `<select id="${id}" class="form-control column-filter-input" data-filter-field="${filterField}" aria-label="${filterLabel}" hidden></select>`
				: `<input id="${id}" type="search" class="form-control column-filter-input" data-filter-field="${filterField}" aria-label="${filterLabel}" placeholder="${escape_attr(
						__("Search")
				  )}" hidden>`;
		return `<div class="column-heading">
			${this.render_sort_header(sortField, label)}
			<button type="button" class="btn btn-xs column-filter-toggle" data-filter-field="${filterField}" aria-label="${filterLabel}" title="${filterLabel}" aria-controls="${id}" aria-expanded="false">
				${get_icon("filter")}
			</button>
		</div>${input}`;
	}

	bind_column_filters() {
		this.$tableShell.off(".donationControls");
		this.$tableShell.on("click.donationControls", ".sort-button", (event) =>
			this.update_sort($(event.currentTarget).data("sort-field"))
		);
		this.$tableShell.on("click.donationControls", ".column-filter-toggle", (event) => {
			const field = $(event.currentTarget).data("filter-field");
			if (this.openColumnFilters.has(field)) {
				this.openColumnFilters.delete(field);
				if (this.filters[field] || this.pendingColumnFilterField === field) {
					this.set_column_filter(field, "", 0);
				}
			} else {
				this.openColumnFilters.add(field);
			}
			this.sync_column_filters();
			if (this.openColumnFilters.has(field)) {
				this.$tableShell
					.find(`.column-filter-input[data-filter-field="${field}"]`)
					.trigger("focus");
			}
		});
		this.$tableShell.on("input.donationControls", "input.column-filter-input", (event) =>
			this.change_column_filter(event, 300)
		);
		this.$tableShell.on("change.donationControls", "select.column-filter-input", (event) =>
			this.change_column_filter(event, 0)
		);
	}

	change_column_filter(event, delay) {
		const field = $(event.currentTarget).data("filter-field");
		this.set_column_filter(field, event.currentTarget.value, delay);
	}

	set_column_filter(field, value, delay) {
		this.filters[field] = value;
		this.sync_column_filters();
		this.on_invalidate();
		clearTimeout(this.columnFilterTimeout);
		this.columnFilterTimeout = null;
		this.pendingColumnFilterField = null;
		if (delay) {
			this.pendingColumnFilterField = field;
			this.columnFilterTimeout = setTimeout(() => this.notify(), delay);
		} else {
			this.notify();
		}
	}

	sync_column_filters() {
		this.$tableShell.find(".sort-button").each((_, button) => {
			$(button)
				.find(".sort-indicator")
				.html(this.get_sort_indicator($(button).data("sort-field")));
		});

		this.$tableShell.find(".column-filter-input").each((_, input) => {
			const field = $(input).data("filter-field");
			const value = this.filters[field] || "";
			if (input.value !== value) $(input).val(value);
			input.hidden = !this.openColumnFilters.has(field);
		});
		this.$tableShell.find(".column-filter-toggle").each((_, button) => {
			const field = $(button).data("filter-field");
			$(button)
				.toggleClass("active", Boolean(this.filters[field]?.trim()))
				.attr("aria-expanded", String(this.openColumnFilters.has(field)));
		});
	}

	render_sort_header(field, label) {
		return `
			<button type="button" class="sort-button" data-sort-field="${escape_attr(field)}">
				<span>${escape_html(label)}</span>
				<span class="sort-indicator">${this.get_sort_indicator(field)}</span>
			</button>
		`;
	}

	get_sort_indicator(field) {
		if (this.sort?.field !== field) {
			return "";
		}
		return this.sort.direction === "asc" ? "&uarr;" : "&darr;";
	}

	update_sort(field) {
		if (this.sort?.field !== field) {
			this.sort = { field, direction: "asc" };
		} else if (this.sort.direction === "asc") {
			this.sort = { field, direction: "desc" };
		} else {
			this.sort = null;
		}
		this.on_invalidate();
		this.cancel_pending();
		return this.notify();
	}
}
