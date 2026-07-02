frappe.provide("verein.donation_management");

const BOOKING_DATE_RANGE_PRESETS = {
	CUSTOM: __("Custom"),
	LAST_THREE_MONTHS: __("Last Three Months"),
	LAST_HALF_YEAR: __("Last Half Year"),
	LAST_YEAR: __("Last Year"),
	LAST_THREE_YEARS: __("Last Three Years"),
};
const BOOKING_PAGE_LENGTH = 200;

frappe.pages["cost-center-bookings"].on_page_load = function (wrapper) {
	if (!wrapper.costCenterBookings) {
		wrapper.costCenterBookings = new verein.donation_management.CostCenterBookingsPage(wrapper);
	}
};

frappe.pages["cost-center-bookings"].refresh = function (wrapper) {
	wrapper.costCenterBookings?.refresh();
};

verein.donation_management.CostCenterBookingsPage = class CostCenterBookingsPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.costCenters = [];
		this.entries = [];
		this.summary = {};
		this.hasMore = false;
		this.nextLimitStart = 0;
		this.sort = {field: "posting_date", direction: "desc"};
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Buchungen"),
			single_column: true,
		});
		this.inject_styles();
		this.make_controls();
		this.make_layout();
		this.refresh();
	}

	inject_styles() {
		if (document.getElementById("cost-center-bookings-styles")) {
			return;
		}

		$(`<style id="cost-center-bookings-styles">
			.cost-center-bookings {
				display: flex;
				flex-direction: column;
				gap: 1rem;
			}

			.cost-center-bookings .filter-row {
				display: grid;
				grid-template-columns: minmax(220px, 1.3fr) minmax(160px, 0.8fr) minmax(140px, 0.7fr) minmax(140px, 0.7fr) auto;
				gap: 0.75rem;
				align-items: end;
			}

			.cost-center-bookings .form-group.frappe-control {
				margin-bottom: 0;
				padding-left: 0;
				padding-right: 0;
				width: 100%;
			}

			.cost-center-bookings .kpi-grid {
				display: grid;
				grid-template-columns: repeat(3, minmax(150px, 1fr));
				gap: 0.75rem;
			}

			.cost-center-bookings .kpi,
			.cost-center-bookings .table-shell,
			.cost-center-bookings .empty-state {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
			}

			.cost-center-bookings .kpi {
				padding: 0.85rem 1rem;
				min-width: 0;
			}

			.cost-center-bookings .kpi-label {
				color: var(--text-muted);
				font-size: 0.75rem;
				font-weight: 600;
				text-transform: uppercase;
				margin-bottom: 0.35rem;
			}

			.cost-center-bookings .kpi-value {
				font-size: 1.35rem;
				font-weight: 700;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.cost-center-bookings .table-shell {
				overflow-x: auto;
			}

			.cost-center-bookings table {
				margin-bottom: 0;
				min-width: 720px;
			}

			.cost-center-bookings td,
			.cost-center-bookings th {
				vertical-align: middle;
			}

			.cost-center-bookings .amount-cell {
				text-align: right;
				white-space: nowrap;
			}

			.cost-center-bookings .remarks-cell {
				max-width: 240px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.cost-center-bookings .sort-button {
				border: 0;
				background: transparent;
				color: inherit;
				font: inherit;
				font-weight: 600;
				padding: 0;
				display: inline-flex;
				align-items: center;
				gap: 0.25rem;
				cursor: pointer;
			}

			.cost-center-bookings .sort-indicator {
				color: var(--text-muted);
				font-size: 0.75rem;
				min-width: 0.75rem;
			}

			.cost-center-bookings .empty-state {
				padding: 2rem;
				color: var(--text-muted);
				text-align: center;
			}

			.cost-center-bookings .load-more-row {
				display: flex;
				justify-content: center;
			}

			@media (max-width: 900px) {
				.cost-center-bookings .filter-row,
				.cost-center-bookings .kpi-grid {
					grid-template-columns: 1fr 1fr;
				}
			}

			@media (max-width: 560px) {
				.cost-center-bookings .filter-row,
				.cost-center-bookings .kpi-grid {
					grid-template-columns: 1fr;
				}

				.cost-center-bookings .filter-row .btn,
				.cost-center-bookings .load-more-row .btn {
					width: 100%;
				}
			}
		</style>`).appendTo("head");
	}

	make_controls() {
		this.costCenterControl = this.make_control({
			fieldtype: "Select",
			label: __("Cost Center"),
			fieldname: "cost_center",
			options: [],
			change: () => this.load_bookings(true),
		});
		this.dateRangeControl = this.make_control({
			fieldtype: "Select",
			label: __("Period"),
			fieldname: "date_range",
			options: Object.values(BOOKING_DATE_RANGE_PRESETS),
			default: BOOKING_DATE_RANGE_PRESETS.CUSTOM,
			change: () => this.apply_date_range_preset(),
		});
		this.fromDateControl = this.make_control({
			fieldtype: "Date",
			label: __("From Date"),
			fieldname: "from_date",
			change: () => this.mark_custom_date_range(),
		});
		this.toDateControl = this.make_control({
			fieldtype: "Date",
			label: __("To Date"),
			fieldname: "to_date",
			change: () => this.mark_custom_date_range(),
		});
	}

	make_control(df) {
		const control = frappe.ui.form.make_control({
			parent: $("<div>"),
			df,
			render_input: true,
		});
		return control;
	}

	make_layout() {
		this.$root = $('<div class="cost-center-bookings">').appendTo(this.page.main);
		this.$filterRow = $('<div class="filter-row">').appendTo(this.$root);
		this.$filterRow.append(this.costCenterControl.$wrapper);
		this.$filterRow.append(this.dateRangeControl.$wrapper);
		this.$filterRow.append(this.fromDateControl.$wrapper);
		this.$filterRow.append(this.toDateControl.$wrapper);
		this.$refreshButton = $(`<button class="btn btn-primary">${__("Refresh")}</button>`)
			.on("click", () => this.load_bookings(true))
			.appendTo(this.$filterRow);

		this.$emptyState = $('<div class="empty-state">').hide().appendTo(this.$root);
		this.$kpiGrid = $('<div class="kpi-grid">').appendTo(this.$root);
		this.$tableShell = $('<div class="table-shell">').appendTo(this.$root);
		this.$loadMoreRow = $('<div class="load-more-row">').appendTo(this.$root);
		this.$loadMoreButton = $(`<button class="btn btn-secondary">${__("Load More")}</button>`)
			.on("click", () => this.load_bookings(false))
			.appendTo(this.$loadMoreRow);
	}

	mark_custom_date_range() {
		if (this.applyingDateRangePreset || this.dateRangeControl.get_value() === BOOKING_DATE_RANGE_PRESETS.CUSTOM) {
			return;
		}
		if (this.current_dates_match_selected_preset()) {
			return;
		}
		this.dateRangeControl.set_value(BOOKING_DATE_RANGE_PRESETS.CUSTOM);
	}

	apply_date_range_preset() {
		const selectedRange = this.dateRangeControl.get_value();
		if (!selectedRange || selectedRange === BOOKING_DATE_RANGE_PRESETS.CUSTOM) {
			return;
		}

		const months = this.get_months_for_date_range(selectedRange);
		if (!months) {
			return;
		}

		const toDate = frappe.datetime.now_date();
		const fromDate = frappe.datetime.add_months(toDate, -months);
		this.applyingDateRangePreset = true;
		this.fromDateControl.set_value(fromDate);
		this.toDateControl.set_value(toDate);
		setTimeout(() => {
			this.applyingDateRangePreset = false;
		}, 0);
		this.load_bookings(true);
	}

	get_months_for_date_range(selectedRange) {
		return {
			[BOOKING_DATE_RANGE_PRESETS.LAST_THREE_MONTHS]: 3,
			[BOOKING_DATE_RANGE_PRESETS.LAST_HALF_YEAR]: 6,
			[BOOKING_DATE_RANGE_PRESETS.LAST_YEAR]: 12,
			[BOOKING_DATE_RANGE_PRESETS.LAST_THREE_YEARS]: 36,
		}[selectedRange];
	}

	current_dates_match_selected_preset() {
		const selectedRange = this.dateRangeControl.get_value();
		const months = this.get_months_for_date_range(selectedRange);
		if (!months) {
			return false;
		}

		const toDate = frappe.datetime.now_date();
		const fromDate = frappe.datetime.add_months(toDate, -months);
		return this.fromDateControl.get_value() === fromDate && this.toDateControl.get_value() === toDate;
	}

	async refresh() {
		await this.load_cost_centers();
	}

	async load_cost_centers() {
		const response = await frappe.call({
			method: "verein.donation_management.cost_center_dashboard.get_accessible_cost_centers",
		});
		this.costCenters = response.message || [];
		const options = this.costCenters.map((row) => ({
			label: row.cost_center_name || row.name,
			value: row.name,
		}));
		this.costCenterControl.df.options = options;
		this.costCenterControl.refresh();

		if (!options.length) {
			this.show_empty(__("No cost centers have been shared with you yet."));
			return;
		}

		if (!this.costCenterControl.get_value()) {
			this.costCenterControl.set_value(options[0].value);
		}
		await this.load_bookings(true);
	}

	async load_bookings(reset) {
		const costCenter = this.costCenterControl.get_value();
		if (!costCenter) {
			return;
		}

		if (reset) {
			this.entries = [];
			this.nextLimitStart = 0;
		}

		this.$loadMoreButton.prop("disabled", true);
		try {
			const response = await frappe.call({
				method: "verein.donation_management.cost_center_bookings.get_booking_entries",
				args: {
					cost_center: costCenter,
					from_date: this.fromDateControl.get_value(),
					to_date: this.toDateControl.get_value(),
					limit_start: reset ? 0 : this.nextLimitStart,
					limit: BOOKING_PAGE_LENGTH,
					order_by: this.sort.field,
					order_direction: this.sort.direction,
				},
				freeze: true,
			});
			const data = response.message || {};
			this.summary = data.summary || {};
			this.hasMore = Boolean(data.has_more);
			this.nextLimitStart = data.next_limit_start || 0;
			this.entries = reset ? data.entries || [] : this.entries.concat(data.entries || []);
			this.render();
		} catch (error) {
			this.show_empty(error.message || __("Bookings could not be loaded."));
		} finally {
			this.$loadMoreButton.prop("disabled", false);
		}
	}

	render() {
		this.$emptyState.hide();
		this.$kpiGrid.show();
		this.$tableShell.show();
		this.render_kpis();
		this.render_table();
		this.$loadMoreRow.toggle(this.hasMore);
	}

	show_empty(message) {
		this.$emptyState.text(message).show();
		this.$kpiGrid.hide();
		this.$tableShell.hide();
		this.$loadMoreRow.hide();
	}

	render_kpis() {
		const items = [
			[__("Income"), this.summary.income],
			[__("Expense"), this.summary.expense],
			[__("Net"), this.summary.net],
		];
		this.$kpiGrid.empty();
		items.forEach(([label, value]) => {
			$(`
				<div class="kpi">
					<div class="kpi-label">${frappe.utils.escape_html(label)}</div>
					<div class="kpi-value">${this.format_currency(value)}</div>
				</div>
			`).appendTo(this.$kpiGrid);
		});
	}

	render_table() {
		if (!this.entries.length) {
			this.$tableShell.html(`<div class="empty-state">${__("No bookings found for the selected period.")}</div>`);
			return;
		}

		const rows = this.entries.map((row) => this.render_row(row)).join("");
		this.$tableShell.html(`
			<table class="table table-bordered">
				<thead>
					<tr>
						<th>${this.render_sort_header("posting_date", __("Date"))}</th>
						<th>${this.render_sort_header("account", __("Account"))}</th>
						<th>${this.render_sort_header("remarks", __("Remarks"))}</th>
						<th class="amount-cell">${this.render_sort_header("net", __("Net"))}</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		`);
		this.$tableShell.find(".sort-button").on("click", (event) => {
			this.update_sort($(event.currentTarget).data("sort-field"));
		});
	}

	render_row(row) {
		return `
			<tr>
				<td>${frappe.datetime.str_to_user(row.posting_date)}</td>
				<td>${this.escape(row.account_name || row.account)}</td>
				<td class="remarks-cell" title="${this.escape_attr(row.remarks || "")}">${this.escape(row.remarks || "")}</td>
				<td class="amount-cell">${this.format_currency(row.net)}</td>
			</tr>
		`;
	}

	render_sort_header(field, label) {
		return `
			<button type="button" class="sort-button" data-sort-field="${this.escape_attr(field)}">
				<span>${this.escape(label)}</span>
				<span class="sort-indicator">${this.get_sort_indicator(field)}</span>
			</button>
		`;
	}

	get_sort_indicator(field) {
		if (this.sort.field !== field) {
			return "";
		}
		return this.sort.direction === "asc" ? "&uarr;" : "&darr;";
	}

	update_sort(field) {
		if (this.sort.field === field) {
			this.sort.direction = this.sort.direction === "asc" ? "desc" : "asc";
		} else {
			this.sort = {field, direction: field === "posting_date" ? "desc" : "asc"};
		}
		this.load_bookings(true);
	}

	format_currency(value) {
		return format_currency(flt(value || 0));
	}

	escape(value) {
		return frappe.utils.escape_html(value || "");
	}

	escape_attr(value) {
		return this.escape(value).replace(/"/g, "&quot;");
	}
};
