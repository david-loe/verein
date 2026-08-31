frappe.provide("verein.donation_management");

const BOOKING_DATE_RANGE_PRESETS = {
	CUSTOM: __("Custom"),
	LAST_THREE_MONTHS: __("Last Three Months"),
	LAST_HALF_YEAR: __("Last Half Year"),
	LAST_YEAR: __("Last Year"),
	LAST_THREE_YEARS: __("Last Three Years"),
};
const COST_CENTER_BOOKINGS_FILTER_STORAGE_KEY = "verein.donation_management.cost_center_filters";
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
		this.bookingRequestGeneration = 0;
		this.sort = { field: "posting_date", direction: "desc" };
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Bookings"),
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
				gap: 16px;
				width: auto;
				max-width: none;
			}

			.cost-center-bookings .filter-row {
				display: grid;
				grid-template-columns: minmax(180px, 300px) minmax(140px, 180px) minmax(120px, 150px) minmax(120px, 150px);
				gap: 12px;
				align-items: end;
				justify-content: start;
			}

			.cost-center-bookings .filter-row > * {
				min-width: 0;
			}

			.cost-center-bookings .form-group.frappe-control {
				margin-bottom: 0;
				padding-left: 0;
				padding-right: 0;
				width: 100%;
			}

			.cost-center-bookings .control-input-wrapper,
			.cost-center-bookings .control-input,
			.cost-center-bookings .input-with-feedback,
			.cost-center-bookings select {
				width: 100%;
				min-width: 0;
			}

			.cost-center-bookings .load-more-row {
				display: flex;
				justify-content: center;
			}

			.cost-center-bookings .load-more-row .btn {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				gap: 6px;
				min-height: 32px;
				white-space: nowrap;
			}

			.cost-center-bookings .kpi-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
				gap: 12px;
			}

			.cost-center-bookings .kpi,
			.cost-center-bookings .table-shell {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
			}

			.cost-center-bookings .kpi {
				padding: 14px 16px;
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
				line-height: 1.25;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.cost-center-bookings .table-shell {
				overflow-x: auto;
				overflow-y: hidden;
			}

			.cost-center-bookings table {
				margin-bottom: 0;
				min-width: 680px;
			}

			.cost-center-bookings td,
			.cost-center-bookings th {
				vertical-align: middle;
			}

			.cost-center-bookings .amount-cell {
				text-align: right;
				white-space: nowrap;
			}

			.cost-center-bookings .date-cell {
				white-space: nowrap;
			}

			.cost-center-bookings .remarks-cell {
				max-width: 260px;
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
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
				padding: 32px;
				color: var(--text-muted);
				text-align: center;
			}

			.cost-center-bookings .table-empty-state,
			.cost-center-bookings .loading-state {
				padding: 32px;
				color: var(--text-muted);
				text-align: center;
			}

			@media (max-width: 900px) {
				.cost-center-bookings .filter-row,
				.cost-center-bookings .kpi-grid {
					grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
				}
			}

			@media (max-width: 560px) {
				.cost-center-bookings .filter-row,
				.cost-center-bookings .kpi-grid {
					grid-template-columns: minmax(0, 1fr);
				}

				.cost-center-bookings .filter-row {
					gap: 8px;
				}

				.cost-center-bookings .form-group.frappe-control,
				.cost-center-bookings .form-group.horizontal {
					margin-bottom: 0 !important;
					padding: 0 !important;
				}

				.cost-center-bookings .control-label {
					margin-bottom: 2px;
					line-height: 1.2;
					min-height: 0;
				}

				.cost-center-bookings .control-input-wrapper,
				.cost-center-bookings .control-input {
					margin: 0 !important;
					padding: 0 !important;
				}

				.cost-center-bookings .input-with-feedback,
				.cost-center-bookings select {
					margin: 0 !important;
				}

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
			change: () => this.handle_cost_center_change(),
		});
		this.dateRangeControl = this.make_control({
			fieldtype: "Select",
			label: __("Period"),
			fieldname: "date_range",
			options: Object.values(BOOKING_DATE_RANGE_PRESETS),
			default: BOOKING_DATE_RANGE_PRESETS.LAST_HALF_YEAR,
			change: () => this.handle_date_range_change(),
		});
		this.fromDateControl = this.make_control({
			fieldtype: "Date",
			label: __("From Date"),
			fieldname: "from_date",
			change: () => this.handle_date_change(),
		});
		this.toDateControl = this.make_control({
			fieldtype: "Date",
			label: __("To Date"),
			fieldname: "to_date",
			change: () => this.handle_date_change(),
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
		this.$root = $('<div class="cost-center-bookings d-flex flex-column m-2 m-sm-3">').appendTo(this.page.main);
		this.$filterRow = $('<div class="filter-row">').appendTo(this.$root);
		this.$filterRow.append(this.costCenterControl.$wrapper);
		this.$filterRow.append(this.dateRangeControl.$wrapper);
		this.$filterRow.append(this.fromDateControl.$wrapper);
		this.$filterRow.append(this.toDateControl.$wrapper);

		this.$emptyState = $('<div class="empty-state">').hide().appendTo(this.$root);
		this.$kpiGrid = $('<div class="kpi-grid">').appendTo(this.$root);
		this.$tableShell = $('<div class="table-shell">').appendTo(this.$root);
		this.$loadMoreRow = $('<div class="load-more-row">').hide().appendTo(this.$root);
		this.$loadMoreButton = $(
			`<button class="btn btn-secondary">${this.get_icon("chevrons-down")}${__("Load More")}</button>`
		)
			.on("click", () => this.load_bookings(false))
			.appendTo(this.$loadMoreRow);
	}

	handle_cost_center_change() {
		if (this.restoringFilters) {
			return;
		}
		this.store_filters();
		this.load_bookings(true);
	}

	async handle_date_range_change() {
		if (this.restoringFilters) {
			return;
		}
		await this.apply_date_range_preset();
	}

	async handle_date_change() {
		if (this.restoringFilters) {
			return;
		}
		await this.mark_custom_date_range();
		if (this.applyingDateRangePreset) {
			return;
		}
		this.store_filters();
		clearTimeout(this.dateRefreshTimeout);
		this.dateRefreshTimeout = setTimeout(() => this.load_bookings(true), 300);
	}

	async mark_custom_date_range() {
		if (this.applyingDateRangePreset || this.dateRangeControl.get_value() === BOOKING_DATE_RANGE_PRESETS.CUSTOM) {
			return;
		}
		if (this.current_dates_match_selected_preset()) {
			return;
		}
		this.restoringFilters = true;
		try {
			await this.dateRangeControl.set_value(BOOKING_DATE_RANGE_PRESETS.CUSTOM);
		} finally {
			this.restoringFilters = false;
		}
	}

	async apply_date_range_preset() {
		const selectedRange = this.dateRangeControl.get_value();
		if (!selectedRange || selectedRange === BOOKING_DATE_RANGE_PRESETS.CUSTOM) {
			this.store_filters();
			return;
		}

		const dates = this.get_dates_for_date_range(selectedRange);
		if (!dates) {
			return;
		}

		this.applyingDateRangePreset = true;
		try {
			await Promise.all([
				this.fromDateControl.set_value(dates.from_date),
				this.toDateControl.set_value(dates.to_date),
			]);
		} finally {
			this.applyingDateRangePreset = false;
		}
		this.store_filters();
		await this.load_bookings(true);
	}

	get_dates_for_date_range(selectedRange) {
		const months = this.get_months_for_date_range(selectedRange);
		if (!months) {
			return null;
		}

		const toDate = frappe.datetime.now_date();
		return {
			from_date: this.get_month_start(frappe.datetime.add_months(toDate, -months)),
			to_date: toDate,
		};
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
		const fromDate = this.get_month_start(frappe.datetime.add_months(toDate, -months));
		return this.fromDateControl.get_value() === fromDate && this.toDateControl.get_value() === toDate;
	}

	get_month_start(date) {
		return moment(date).startOf("month").format("YYYY-MM-DD");
	}

	get_stored_filters() {
		try {
			const filters = JSON.parse(sessionStorage.getItem(COST_CENTER_BOOKINGS_FILTER_STORAGE_KEY) || "null");
			return filters && typeof filters === "object" ? filters : null;
		} catch {
			return null;
		}
	}

	store_filters() {
		try {
			sessionStorage.setItem(
				COST_CENTER_BOOKINGS_FILTER_STORAGE_KEY,
				JSON.stringify({
					cost_center: this.costCenterControl.get_value() || null,
					period: this.dateRangeControl.get_value() || null,
					from_date: this.fromDateControl.get_value() || null,
					to_date: this.toDateControl.get_value() || null,
				})
			);
		} catch {
			// Ignore storage failures; filters should still work for the current page.
		}
	}

	get_valid_stored_cost_center(options, storedFilters) {
		const storedCostCenter = storedFilters?.cost_center;
		return options.some((option) => option.value === storedCostCenter) ? storedCostCenter : null;
	}

	get_valid_stored_period(storedFilters) {
		const storedPeriod = storedFilters?.period;
		return Object.values(BOOKING_DATE_RANGE_PRESETS).includes(storedPeriod) ? storedPeriod : null;
	}

	has_stored_dates(storedFilters) {
		return Boolean(storedFilters?.from_date && storedFilters?.to_date);
	}

	async restore_filters(options) {
		const storedFilters = this.get_stored_filters();
		const costCenter = this.get_valid_stored_cost_center(options, storedFilters) || options[0].value;
		const hasStoredDates = this.has_stored_dates(storedFilters);
		let period = this.get_valid_stored_period(storedFilters) || BOOKING_DATE_RANGE_PRESETS.LAST_HALF_YEAR;
		if (period === BOOKING_DATE_RANGE_PRESETS.CUSTOM && !hasStoredDates) {
			period = BOOKING_DATE_RANGE_PRESETS.LAST_HALF_YEAR;
		}

		const dates = hasStoredDates
			? {
					from_date: storedFilters.from_date,
					to_date: storedFilters.to_date,
				}
			: this.get_dates_for_date_range(period);

		this.restoringFilters = true;
		try {
			await this.costCenterControl.set_value(costCenter);
			await this.dateRangeControl.set_value(period);
			if (dates) {
				await Promise.all([
					this.fromDateControl.set_value(dates.from_date),
					this.toDateControl.set_value(dates.to_date),
				]);
			}
		} finally {
			this.restoringFilters = false;
		}
		this.store_filters();
	}

	async refresh() {
		if (this.refreshPromise) {
			return this.refreshPromise;
		}

		this.refreshPromise = this.load_cost_centers();
		try {
			await this.refreshPromise;
		} finally {
			this.refreshPromise = null;
		}
	}

	async load_cost_centers() {
		const response = await frappe.call({
			method: "verein.donation_management.cost_center_dashboard.get_accessible_cost_centers",
		});
		this.costCenters = response.message || [];
		const options = this.costCenters.map((row) => ({
			label: row.display_name || row.cost_center_name || row.name,
			value: row.name,
		}));
		this.costCenterControl.df.options = options;
		this.costCenterControl.refresh();

		if (!options.length) {
			this.show_empty(__("No cost centers have been shared with you yet."));
			return;
		}

		await this.restore_filters(options);
		await this.load_bookings(true);
	}

	async load_bookings(reset) {
		const costCenter = this.costCenterControl.get_value();
		if (!costCenter) {
			return;
		}
		const requestGeneration = ++this.bookingRequestGeneration;

		if (reset) {
			this.entries = [];
			this.summary = {};
			this.nextLimitStart = 0;
			this.hasMore = false;
			this.$loadMoreRow.hide();
			this.show_loading();
		}

		this.set_load_more_loading(true);
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
			});
			if (requestGeneration !== this.bookingRequestGeneration) {
				return;
			}
			const data = response.message || {};
			this.summary = data.summary || {};
			this.hasMore = Boolean(data.has_more);
			this.nextLimitStart = data.next_limit_start || 0;
			this.entries = reset ? data.entries || [] : this.entries.concat(data.entries || []);
			this.render();
		} catch (error) {
			if (requestGeneration !== this.bookingRequestGeneration) {
				return;
			}
			this.show_empty(error.message || __("Bookings could not be loaded."));
		} finally {
			if (requestGeneration === this.bookingRequestGeneration) {
				this.set_load_more_loading(false);
			}
		}
	}

	show_loading() {
		this.$emptyState.hide();
		this.$kpiGrid.hide();
		this.$tableShell
			.show()
			.html(`<div class="loading-state">${this.get_icon("loader-circle")}${__("Loading data...")}</div>`);
	}

	set_load_more_loading(loading) {
		this.$loadMoreButton
			.prop("disabled", loading)
			.html(
				loading
					? `${this.get_icon("loader-circle")}${__("Loading...")}`
					: `${this.get_icon("chevrons-down")}${__("Load More")}`
			);
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
			this.$tableShell.html(`<div class="table-empty-state">${__("No bookings found for the selected period.")}</div>`);
			return;
		}

		const rows = this.entries.map((row) => this.render_row(row)).join("");
		this.$tableShell.html(`
			<table class="table table-bordered">
				<thead>
					<tr>
						<th class="date-cell">${this.render_sort_header("posting_date", __("Date"))}</th>
						<th class="amount-cell">${this.render_sort_header("net", __("Donation Amount"))}</th>
						<th>${this.render_sort_header("account", __("Account"))}</th>
						<th>${this.render_sort_header("remarks", __("Remarks"))}</th>
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
				<td class="date-cell">${frappe.datetime.str_to_user(row.posting_date)}</td>
				<td class="amount-cell">${this.format_currency(row.net)}</td>
				<td>${this.escape(row.account_name || row.account)}</td>
				<td class="remarks-cell" title="${this.escape_attr(row.remarks || "")}">${this.escape(row.remarks || "")}</td>
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
			this.sort = { field, direction: field === "posting_date" ? "desc" : "asc" };
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

	get_icon(icon) {
		return frappe.utils.icon(icon, "sm");
	}
};
