/* global verein */
frappe.provide("verein.donation_management");

const DONOR_DATE_RANGE_PRESETS = {
	CUSTOM: __("Custom"),
	LAST_THREE_MONTHS: __("Last Three Months"),
	LAST_HALF_YEAR: __("Last Half Year"),
	LAST_YEAR: __("Last Year"),
	LAST_THREE_YEARS: __("Last Three Years"),
};
const DONATION_MANAGEMENT_FILTER_STORAGE_KEY = "verein.donation_management.cost_center_filters";
const DONOR_PAGE_LENGTH = 100;
const DONOR_BOOKING_PAGE_LENGTH = 100;
const DONOR_CHANGE_FIELDS = [
	["first_name", __("First Name"), "Data"],
	["last_name", __("Last Name"), "Data"],
	["email_address", __("Email Address"), "Data"],
	["phone", __("Phone"), "Data"],
	["address_line_1", __("Address Line 1"), "Data"],
	["address_line_2", __("Address Line 2"), "Data"],
	["postal_code", __("Postal Code"), "Data"],
	["city", __("City"), "Data"],
	["country", __("Country"), "Link", "Country"],
];

frappe.pages["donors"].on_page_load = function (wrapper) {
	if (!wrapper.donorsPage) {
		wrapper.donorsPage = new verein.donation_management.DonorsPage(wrapper);
	}
};

frappe.pages["donors"].refresh = function (wrapper) {
	wrapper.donorsPage?.refresh();
};

verein.donation_management.DonorsPage = class DonorsPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.costCenters = [];
		this.donors = [];
		this.columnFilters = { search: "" };
		this.openColumnFilters = new Set();
		this.pendingColumnFilterField = null;
		this.summary = {};
		this.hasMore = false;
		this.nextLimitStart = 0;
		this.expandedDonors = new Set();
		this.donorBookings = {};
		this.donorRequestGeneration = 0;
		this.sort = null;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Donors"),
			single_column: true,
		});
		this.inject_styles();
		this.make_controls();
		this.make_layout();
		this.refresh();
	}

	inject_styles() {
		if (document.getElementById("donors-page-styles")) {
			return;
		}

		$(`<style id="donors-page-styles">
			.donors-page {
				gap: 16px;
				width: auto;
				max-width: none;
			}

			.donors-page .filter-row {
				display: grid;
				grid-template-columns: minmax(180px, 240px) minmax(180px, 300px) minmax(140px, 180px) minmax(120px, 150px) minmax(120px, 150px);
				gap: 12px;
				align-items: end;
				justify-content: start;
			}

			.donors-page .filter-row.company-filter-hidden {
				grid-template-columns: minmax(180px, 300px) minmax(140px, 180px) minmax(120px, 150px) minmax(120px, 150px);
			}

			.donors-page .filter-row > * {
				min-width: 0;
			}

			.donors-page .form-group.frappe-control {
				margin-bottom: 0;
				padding-left: 0;
				padding-right: 0;
				width: 100%;
			}

			.donors-page .control-input-wrapper,
			.donors-page .control-input,
			.donors-page .input-with-feedback,
			.donors-page select {
				width: 100%;
				min-width: 0;
			}

			.donors-page .kpi-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
				gap: 12px;
			}

			.donors-page .kpi,
			.donors-page .table-shell {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
			}

			.donors-page .kpi {
				padding: 14px 16px;
				min-width: 0;
			}

			.donors-page .kpi-label {
				color: var(--text-muted);
				font-size: 0.75rem;
				font-weight: 600;
				text-transform: uppercase;
				margin-bottom: 0.35rem;
			}

			.donors-page .kpi-value {
				font-size: 1.35rem;
				font-weight: 700;
				line-height: 1.25;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.donors-page .table-shell {
				overflow-x: auto;
				overflow-y: hidden;
			}

			.donors-page .table-shell > table {
				margin: 0;
				border: 0;
				border-collapse: separate;
				border-spacing: 0;
			}

			.donors-page .table-shell > table > thead > tr > th,
			.donors-page .table-shell > table > tbody > tr > td {
				border: 0;
				border-right: 1px solid var(--border-color);
				border-bottom: 1px solid var(--border-color);
			}

			.donors-page .table-shell > table > thead > tr > th:last-child,
			.donors-page .table-shell > table > tbody > tr > td:last-child {
				border-right: 0;
			}

			.donors-page .table-shell > table > tbody > tr:last-child > td {
				border-bottom: 0;
			}

			.donors-page .table-shell > table > thead {
				position: relative;
				z-index: 2;
				background: var(--card-bg);
			}

			.donors-page .table-shell > table > thead > tr > th {
				background: var(--card-bg);
			}

			.donors-page table {
				margin-bottom: 0;
				min-width: 860px;
			}

			.donors-page .booking-table {
				min-width: 560px;
			}

			.donors-page td,
			.donors-page th {
				vertical-align: middle;
			}

			.donors-page .amount-cell,
			.donors-page .count-cell,
			.donors-page .expand-cell {
				text-align: right;
				white-space: nowrap;
			}

			.donors-page .donor-cell {
				min-width: 260px;
			}

			.donors-page .donor-cell-content {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 12px;
			}

			.donors-page .donor-identity {
				display: flex;
				align-items: center;
				flex-wrap: wrap;
				gap: 8px;
				min-width: 0;
			}

			.donors-page .donor-name {
				min-width: 0;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.donors-page .donor-cell .contact-button {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				flex: 0 0 auto;
				gap: 6px;
				min-height: 28px;
				white-space: nowrap;
			}

			.donors-page .expand-cell {
				width: 42px;
				text-align: center;
			}

			.donors-page .expand-button {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				width: 28px;
				height: 28px;
				padding: 0;
			}

			.donors-page .date-cell,
			.donors-page .datetime-cell {
				white-space: nowrap;
			}

			.donors-page .sort-button {
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

			.donors-page .sort-indicator {
				color: var(--text-muted);
				font-size: 0.75rem;
				min-width: 0.75rem;
			}

			.donors-page .empty-state,
			.donors-page .table-empty-state,
			.donors-page .loading-state {
				padding: 32px;
				color: var(--text-muted);
				text-align: center;
			}

			.donors-page .donor-bookings-row > td {
				background: var(--fg-color);
				padding: 0;
			}

			.donors-page .donor-bookings-shell {
				padding: 12px 16px 16px;
				border-top: 1px solid var(--border-color);
			}

			.donors-page .donor-bookings-empty,
			.donors-page .donor-bookings-loading {
				color: var(--text-muted);
				padding: 12px 0;
			}

			.donors-page .booking-remarks-cell {
				max-width: 280px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.donors-page .empty-state {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
			}

			.donor-contact-grid {
				display: grid;
				grid-template-columns: minmax(110px, auto) minmax(0, 1fr);
				gap: 6px 12px;
				margin-bottom: 16px;
			}

			.donor-contact-grid .label {
				color: var(--text-muted);
				font-weight: 600;
			}

			.donors-page .load-more-row {
				display: flex;
				justify-content: center;
			}

			.donors-page .column-heading {
				display: flex;
				align-items: center;
				gap: 8px;
			}

			.donors-page .column-filter-toggle {
				flex-shrink: 0;
				color: var(--text-muted);
			}

			.donors-page .column-filter-toggle.active {
				color: var(--primary);
				background: var(--control-bg);
				box-shadow: inset 0 -2px currentColor;
			}

			.donors-page .column-filter-input {
				margin-top: 8px;
				min-width: 160px;
				width: 100%;
				font-weight: normal;
			}

			@media (max-width: 1000px) {
				.donors-page .filter-row {
					grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
				}
			}

			@media (max-width: 560px) {
				.donors-page .filter-row,
				.donors-page .kpi-grid {
					grid-template-columns: minmax(0, 1fr);
				}

				.donors-page .filter-row {
					gap: 8px;
				}

				.donors-page .form-group.frappe-control,
				.donors-page .form-group.horizontal {
					margin-bottom: 0 !important;
					padding: 0 !important;
				}

				.donors-page .control-label {
					margin-bottom: 2px;
					line-height: 1.2;
					min-height: 0;
				}

				.donors-page .control-input-wrapper,
				.donors-page .control-input {
					margin: 0 !important;
					padding: 0 !important;
				}

				.donors-page .input-with-feedback,
				.donors-page select {
					margin: 0 !important;
				}

				.donors-page .load-more-row .btn {
					width: 100%;
				}
			}
		</style>`).appendTo("head");
	}

	make_controls() {
		this.companyControl = this.make_control({
			fieldtype: "Select",
			label: __("Company"),
			fieldname: "company",
			options: [],
			change: () => this.handle_company_change(),
		});
		this.costCenterControl = this.make_control({
			fieldtype: "Select",
			label: __("Cost Center"),
			fieldname: "cost_center",
			options: [],
			change: () => this.handle_filter_change(),
		});
		this.dateRangeControl = this.make_control({
			fieldtype: "Select",
			label: __("Period"),
			fieldname: "date_range",
			options: Object.values(DONOR_DATE_RANGE_PRESETS),
			default: DONOR_DATE_RANGE_PRESETS.LAST_HALF_YEAR,
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
		return frappe.ui.form.make_control({
			parent: $("<div>"),
			df,
			render_input: true,
		});
	}

	make_layout() {
		this.$root = $('<div class="donors-page d-flex flex-column m-2 m-sm-3">').appendTo(
			this.page.main
		);
		this.$filterRow = $('<div class="filter-row">').appendTo(this.$root);
		this.$filterRow.append(this.companyControl.$wrapper);
		this.$filterRow.append(this.costCenterControl.$wrapper);
		this.$filterRow.append(this.dateRangeControl.$wrapper);
		this.$filterRow.append(this.fromDateControl.$wrapper);
		this.$filterRow.append(this.toDateControl.$wrapper);

		this.$emptyState = $('<div class="empty-state">').hide().appendTo(this.$root);
		this.$kpiGrid = $('<div class="kpi-grid">').appendTo(this.$root);
		this.$tableShell = $('<div class="table-shell">').appendTo(this.$root);
		frappe.require("/assets/verein/js/donation_table_header.js").then(() => {
			if (this.$tableShell[0].isConnected) {
				this.tableHeader = new verein.donation_management.DonationTableHeader(
					this.$tableShell[0]
				);
			}
		});
		this.$loadMoreRow = $('<div class="load-more-row">').hide().appendTo(this.$root);
		this.$loadMoreButton = $(
			`<button class="btn btn-secondary">${this.get_icon("chevrons-down")}${__(
				"Load More"
			)}</button>`
		)
			.on("click", () => this.load_donors(false))
			.appendTo(this.$loadMoreRow);
	}

	async handle_company_change() {
		if (this.restoringFilters) {
			return;
		}
		this.invalidate_requests();

		const options = this.set_cost_center_options(this.companyControl.get_value());
		const currentCostCenter = this.costCenterControl.get_value();
		const costCenter = options.some((option) => option.value === currentCostCenter)
			? currentCostCenter
			: options[0]?.value || "";
		this.restoringFilters = true;
		try {
			await this.costCenterControl.set_value(costCenter);
		} finally {
			this.restoringFilters = false;
		}
		this.store_filters();
		await this.load_donors(true);
	}

	handle_filter_change() {
		if (this.restoringFilters) {
			return;
		}
		this.invalidate_requests();
		this.store_filters();
		this.load_donors(true);
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
		this.invalidate_requests();
		await this.mark_custom_date_range();
		if (this.applyingDateRangePreset) {
			return;
		}
		this.store_filters();
		this.queue_load();
	}

	queue_load() {
		this.invalidate_requests();
		clearTimeout(this.refreshTimeout);
		this.refreshTimeout = setTimeout(() => this.load_donors(true), 300);
	}

	async mark_custom_date_range() {
		if (
			this.applyingDateRangePreset ||
			this.dateRangeControl.get_value() === DONOR_DATE_RANGE_PRESETS.CUSTOM
		) {
			return;
		}
		if (this.current_dates_match_selected_preset()) {
			return;
		}
		this.restoringFilters = true;
		try {
			await this.dateRangeControl.set_value(DONOR_DATE_RANGE_PRESETS.CUSTOM);
		} finally {
			this.restoringFilters = false;
		}
	}

	async apply_date_range_preset() {
		const selectedRange = this.dateRangeControl.get_value();
		if (!selectedRange || selectedRange === DONOR_DATE_RANGE_PRESETS.CUSTOM) {
			this.store_filters();
			return;
		}

		const dates = this.get_dates_for_date_range(selectedRange);
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
		await this.load_donors(true);
	}

	get_dates_for_date_range(selectedRange) {
		const months = this.get_months_for_date_range(selectedRange);
		const toDate = frappe.datetime.now_date();
		return {
			from_date: this.get_month_start(frappe.datetime.add_months(toDate, -months)),
			to_date: toDate,
		};
	}

	get_months_for_date_range(selectedRange) {
		return (
			{
				[DONOR_DATE_RANGE_PRESETS.LAST_THREE_MONTHS]: 3,
				[DONOR_DATE_RANGE_PRESETS.LAST_HALF_YEAR]: 6,
				[DONOR_DATE_RANGE_PRESETS.LAST_YEAR]: 12,
				[DONOR_DATE_RANGE_PRESETS.LAST_THREE_YEARS]: 36,
			}[selectedRange] || 6
		);
	}

	current_dates_match_selected_preset() {
		const selectedRange = this.dateRangeControl.get_value();
		if (selectedRange === DONOR_DATE_RANGE_PRESETS.CUSTOM) {
			return false;
		}
		const dates = this.get_dates_for_date_range(selectedRange);
		return (
			this.fromDateControl.get_value() === dates.from_date &&
			this.toDateControl.get_value() === dates.to_date
		);
	}

	get_month_start(date) {
		return moment(date).startOf("month").format("YYYY-MM-DD");
	}

	get_stored_filters() {
		try {
			const filters = JSON.parse(
				sessionStorage.getItem(DONATION_MANAGEMENT_FILTER_STORAGE_KEY) || "null"
			);
			return filters && typeof filters === "object" ? filters : null;
		} catch {
			return null;
		}
	}

	store_filters() {
		try {
			sessionStorage.setItem(
				DONATION_MANAGEMENT_FILTER_STORAGE_KEY,
				JSON.stringify({
					company: this.companyControl.get_value() || null,
					cost_center: this.costCenterControl.get_value() || null,
					period: this.dateRangeControl.get_value() || null,
					from_date: this.fromDateControl.get_value() || null,
					to_date: this.toDateControl.get_value() || null,
				})
			);
		} catch {
			// Ignore storage failures; filters still work in memory.
		}
	}

	configure_company_filter() {
		this.companies = [...new Set(this.costCenters.map((row) => row.company).filter(Boolean))];
		this.companyControl.df.options = this.companies.map((company) => ({
			label: company,
			value: company,
		}));
		this.companyControl.refresh();
		const showCompany = this.companies.length > 1;
		this.companyControl.$wrapper.toggle(showCompany);
		this.$filterRow.toggleClass("company-filter-hidden", !showCompany);
	}

	set_cost_center_options(company) {
		const options = this.costCenters
			.filter((row) => row.company === company)
			.map((row) => ({
				label: row.display_name || row.cost_center_name || row.name,
				value: row.name,
			}));
		this.costCenterControl.df.options = options;
		this.costCenterControl.refresh();
		return options;
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
		if (!this.costCenters.length) {
			this.show_empty(__("No cost centers have been shared with you yet."));
			return;
		}

		this.configure_company_filter();
		await this.restore_filters();
		await this.load_donors(true);
	}

	async restore_filters() {
		const storedFilters = this.get_stored_filters();
		const storedCostCenter = this.costCenters.find(
			(row) => row.name === storedFilters?.cost_center
		);
		const company =
			storedCostCenter?.company ||
			(this.companies.includes(storedFilters?.company)
				? storedFilters.company
				: this.companies[0]);
		const options = this.set_cost_center_options(company);
		const costCenter =
			storedCostCenter?.company === company
				? storedCostCenter.name
				: options[0]?.value || "";
		const period = Object.values(DONOR_DATE_RANGE_PRESETS).includes(storedFilters?.period)
			? storedFilters.period
			: DONOR_DATE_RANGE_PRESETS.LAST_HALF_YEAR;
		const dates =
			storedFilters?.from_date && storedFilters?.to_date
				? { from_date: storedFilters.from_date, to_date: storedFilters.to_date }
				: this.get_dates_for_date_range(period);

		this.restoringFilters = true;
		try {
			await this.companyControl.set_value(company);
			await this.costCenterControl.set_value(costCenter);
			await this.dateRangeControl.set_value(period);
			await this.fromDateControl.set_value(dates.from_date);
			await this.toDateControl.set_value(dates.to_date);
			this.sync_column_filters();
		} finally {
			this.restoringFilters = false;
		}
		this.store_filters();
	}

	async load_donors(reset) {
		clearTimeout(this.columnFilterTimeout);
		this.columnFilterTimeout = null;
		this.pendingColumnFilterField = null;
		clearTimeout(this.refreshTimeout);
		const costCenter = this.costCenterControl.get_value();
		if (!costCenter) {
			return;
		}
		const requestGeneration = ++this.donorRequestGeneration;

		if (reset) {
			this.donors = [];
			this.summary = {};
			this.nextLimitStart = 0;
			this.expandedDonors.clear();
			this.donorBookings = {};
			this.hasMore = false;
			this.$loadMoreRow.hide();
			this.show_loading();
		}

		this.set_load_more_loading(true);
		try {
			const response = await frappe.call({
				method: "verein.donation_management.supporter_donors.get_donors",
				args: {
					cost_center: costCenter,
					from_date: this.fromDateControl.get_value(),
					to_date: this.toDateControl.get_value(),
					search: this.columnFilters.search,
					limit_start: reset ? 0 : this.nextLimitStart,
					limit: DONOR_PAGE_LENGTH,
					order_by: this.sort?.field || "amount",
					order_direction: this.sort?.direction || "desc",
				},
			});
			if (requestGeneration !== this.donorRequestGeneration) {
				return;
			}
			const data = response.message || {};
			this.summary = data.summary || {};
			this.hasMore = Boolean(data.has_more);
			this.nextLimitStart = data.next_limit_start || 0;
			this.donors = reset ? data.donors || [] : this.donors.concat(data.donors || []);
			this.render();
		} catch (error) {
			if (requestGeneration !== this.donorRequestGeneration) {
				return;
			}
			this.show_table_message(error.message || __("Donors could not be loaded."));
		} finally {
			if (requestGeneration === this.donorRequestGeneration) {
				this.set_load_more_loading(false);
			}
		}
	}

	show_loading() {
		this.show_table_message(__("Loading data..."));
	}

	show_table_message(message) {
		this.$emptyState.hide();
		this.$kpiGrid.hide();
		this.$loadMoreRow.hide();
		this.$tableShell.show();
		this.render_table();
		this.$tableBody.html(
			`<tr><td colspan="7" class="table-empty-state">${this.escape(message)}</td></tr>`
		);
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
			[__("Donors"), this.summary.donor_count || 0],
			[__("Donation Amount"), this.format_currency(this.summary.amount)],
		];
		this.$kpiGrid.empty();
		items.forEach(([label, value]) => {
			$(`
				<div class="kpi">
					<div class="kpi-label">${this.escape(label)}</div>
					<div class="kpi-value">${typeof value === "number" ? this.escape(String(value)) : value}</div>
				</div>
			`).appendTo(this.$kpiGrid);
		});
	}

	render_table() {
		const rows = this.donors.map((row) => this.render_row(row)).join("");
		if (!this.$tableBody) {
			this.$tableShell.html(`
			<table class="table table-bordered">
				<thead>
					<tr>
						<th class="expand-cell"></th>
						<th>${this.render_column_header("full_name", __("Donor"), "search")}</th>
						<th class="amount-cell">${this.render_sort_header("amount", __("Donation Amount"))}</th>
						<th class="count-cell">${this.render_sort_header("booking_count", __("Bookings"))}</th>
						<th class="date-cell">${this.render_sort_header("first_donation_date", __("First Donation"))}</th>
						<th class="date-cell">${this.render_sort_header("last_donation_date", __("Last Donation"))}</th>
						<th class="datetime-cell">${this.render_sort_header(
							"contact_or_address_modified",
							__("Address Modified")
						)}</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		`);
			this.$tableBody = this.$tableShell.find("table > tbody").first();
			this.bind_column_filters();
		}
		this.sync_column_filters();
		this.$tableShell.find(".sort-button").each((_, button) => {
			$(button)
				.find(".sort-indicator")
				.html(this.get_sort_indicator($(button).data("sort-field")));
		});
		this.$tableBody.html(
			rows ||
				`<tr><td colspan="7" class="table-empty-state">${__(
					"No donors found for the selected filters."
				)}</td></tr>`
		);
		this.$tableShell
			.find(".sort-button")
			.off("click")
			.on("click", (event) => {
				this.update_sort($(event.currentTarget).data("sort-field"));
			});
		this.$tableShell.find(".expand-button").on("click", (event) => {
			this.toggle_donor_bookings($(event.currentTarget).data("donor-name"));
		});
		this.$tableShell.find(".donor-bookings-load-more").on("click", (event) => {
			this.load_donor_bookings($(event.currentTarget).data("donor-name"), false);
		});
		this.$tableShell.find(".contact-button").on("click", (event) => {
			const donorName = $(event.currentTarget).data("donor-name");
			const donor = this.donors.find((row) => row.name === donorName);
			if (donor) {
				this.show_contact_dialog(donor);
			}
		});
	}

	render_row(row) {
		const expanded = this.expandedDonors.has(row.name);
		return `
			<tr class="donor-row" data-donor-name="${this.escape_attr(row.name)}">
				<td class="expand-cell">
					<button type="button" class="btn btn-xs btn-secondary expand-button" data-donor-name="${this.escape_attr(
						row.name
					)}" title="${this.escape_attr(expanded ? __("Collapse") : __("Expand"))}">
						${this.get_icon(expanded ? "chevron-down" : "chevron-right")}
					</button>
				</td>
				<td class="donor-cell">
					<div class="donor-cell-content">
						<span class="donor-identity">
							<span class="donor-name">${this.escape(row.full_name || row.name)}</span>
							${this.render_donor_status(row)}
						</span>
						<button type="button" class="btn btn-xs btn-secondary contact-button" data-donor-name="${this.escape_attr(
							row.name
						)}">
							${this.get_icon("contact")}${__("Contact")}
						</button>
					</div>
				</td>
				<td class="amount-cell">${this.format_currency(row.amount)}</td>
				<td class="count-cell">${this.escape(String(row.booking_count || 0))}</td>
				<td class="date-cell">${
					row.first_donation_date
						? frappe.datetime.str_to_user(row.first_donation_date)
						: ""
				}</td>
				<td class="date-cell">${
					row.last_donation_date
						? frappe.datetime.str_to_user(row.last_donation_date)
						: ""
				}</td>
				<td class="datetime-cell">${this.escape(
					this.format_datetime(row.contact_or_address_modified)
				)}</td>
			</tr>
			${expanded ? this.render_donor_bookings_row(row) : ""}
		`;
	}

	render_donor_status(row) {
		if (!row.status) {
			return "";
		}
		const color = frappe.scrub(row.status_color || "Gray", "-");
		return `<span class="donor-status indicator-pill ${this.escape_attr(
			color
		)} no-indicator-dot"
			title="${this.escape_attr(__("Contact Status"))}">
			${this.escape(__(row.status, null, "Supporter"))}
		</span>`;
	}

	render_donor_bookings_row(row) {
		return `
			<tr class="donor-bookings-row" data-donor-name="${this.escape_attr(row.name)}">
				<td colspan="7">
					<div class="donor-bookings-shell">
						${this.render_donor_bookings_content(row.name)}
					</div>
				</td>
			</tr>
		`;
	}

	render_donor_bookings_content(donorName) {
		const state = this.donorBookings[donorName];
		if (!state || state.loading) {
			return `<div class="donor-bookings-loading">${this.escape(__("Loading..."))}</div>`;
		}

		if (state.error) {
			return `<div class="donor-bookings-empty">${this.escape(state.error)}</div>`;
		}

		if (!state.rows.length) {
			return `<div class="donor-bookings-empty">${this.escape(
				__("No donation bookings found.")
			)}</div>`;
		}

		const rows = state.rows.map((booking) => this.render_booking_row(booking)).join("");
		const loadMore = state.hasMore
			? `<div class="mt-2">
				<button type="button" class="btn btn-xs btn-secondary donor-bookings-load-more" data-donor-name="${this.escape_attr(
					donorName
				)}">
					${this.get_icon("chevrons-down")}${__("Load More Bookings")}
				</button>
			</div>`
			: "";

		return `
			<div class="table-responsive">
				<table class="table table-bordered booking-table">
					<thead>
						<tr>
							<th class="date-cell">${this.escape(__("Date"))}</th>
							<th class="amount-cell">${this.escape(__("Donation Amount"))}</th>
							<th>${this.escape(__("Account"))}</th>
							<th>${this.escape(__("Remarks"))}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
			${loadMore}
		`;
	}

	render_booking_row(booking) {
		return `
			<tr>
				<td class="date-cell">${frappe.datetime.str_to_user(booking.posting_date)}</td>
				<td class="amount-cell">${this.format_currency(booking.amount)}</td>
				<td>${this.escape(booking.account_name || booking.account)}</td>
				<td class="booking-remarks-cell" title="${this.escape_attr(booking.remarks || "")}">${this.escape(
			booking.remarks || ""
		)}</td>
			</tr>
		`;
	}

	async toggle_donor_bookings(donorName) {
		if (this.expandedDonors.has(donorName)) {
			this.expandedDonors.delete(donorName);
			this.render_table();
			return;
		}

		this.expandedDonors.add(donorName);
		if (!this.donorBookings[donorName]) {
			this.donorBookings[donorName] = {
				rows: [],
				hasMore: false,
				nextLimitStart: 0,
				loading: true,
			};
			this.render_table();
			await this.load_donor_bookings(donorName, true);
			return;
		}
		this.render_table();
	}

	async load_donor_bookings(donorName, reset) {
		const existing = this.donorBookings[donorName] || {
			rows: [],
			hasMore: false,
			nextLimitStart: 0,
		};
		this.donorBookings[donorName] = {
			...existing,
			rows: reset ? [] : existing.rows,
			nextLimitStart: reset ? 0 : existing.nextLimitStart,
			loading: true,
			error: null,
		};
		const requestState = this.donorBookings[donorName];
		this.render_table();

		try {
			const response = await frappe.call({
				method: "verein.donation_management.supporter_donors.get_donor_bookings",
				args: {
					supporter: donorName,
					cost_center: this.costCenterControl.get_value(),
					from_date: this.fromDateControl.get_value(),
					to_date: this.toDateControl.get_value(),
					limit_start: reset ? 0 : existing.nextLimitStart,
					limit: DONOR_BOOKING_PAGE_LENGTH,
				},
			});
			if (this.donorBookings[donorName] !== requestState) return;
			const data = response.message || {};
			const rows = reset ? data.bookings || [] : existing.rows.concat(data.bookings || []);
			this.donorBookings[donorName] = {
				rows,
				hasMore: Boolean(data.has_more),
				nextLimitStart: data.next_limit_start || rows.length,
				loading: false,
				error: null,
			};
		} catch (error) {
			if (this.donorBookings[donorName] !== requestState) return;
			this.donorBookings[donorName] = {
				...existing,
				loading: false,
				error: error.message || __("Donation bookings could not be loaded."),
			};
		}
		this.render_table();
	}

	show_contact_dialog(donor) {
		const contactFields = [
			{
				fieldname: "contact_change_section",
				fieldtype: "Section Break",
				label: __("Request Change"),
				collapsible: 1,
			},
			...["first_name", "phone", "address_line_1", "address_line_2", "country"].map(
				(fieldname) => this.make_contact_dialog_field(fieldname, donor)
			),
			{ fieldtype: "Column Break" },
			...["last_name", "email_address", "city", "postal_code"].map((fieldname) =>
				this.make_contact_dialog_field(fieldname, donor)
			),
		];
		const dialog = new frappe.ui.Dialog({
			title: `<span class="d-flex align-items-center flex-wrap" style="gap: 8px;">
				<span>${this.escape(donor.full_name || donor.name)}</span>
				${this.render_donor_status(donor)}
			</span>`,
			fields: [
				{
					fieldname: "contact_html",
					fieldtype: "HTML",
					options: this.render_contact_html(donor),
				},
				...contactFields,
			],
			primary_action_label: __("Request Change"),
			primary_action: (values) => this.submit_change_request(dialog, donor, values),
		});
		dialog.show();
		this.bind_contact_change_button_visibility(dialog);
	}

	bind_contact_change_button_visibility(dialog) {
		const $section = dialog.$wrapper.find('[data-fieldname="contact_change_section"]');
		const syncButton = () => {
			dialog
				.get_primary_btn()
				.toggleClass("hide", $section.find(".section-body").hasClass("hide"));
		};
		syncButton();
		$section.find(".section-head").on("click keyup", () => {
			setTimeout(syncButton, 0);
		});
	}

	make_contact_dialog_field(fieldname, donor) {
		const field = DONOR_CHANGE_FIELDS.find(([name]) => name === fieldname);
		const [, label, fieldtype, options] = field;
		return {
			fieldname,
			fieldtype,
			label,
			options,
			default: donor[fieldname] || "",
		};
	}

	render_contact_html(donor) {
		const address = [
			donor.address_line_1,
			donor.address_line_2,
			[donor.postal_code, donor.city].filter(Boolean).join(" "),
			donor.country,
		]
			.filter(Boolean)
			.map((value) => this.escape(value))
			.join("<br>");
		const rows = [
			[__("Email Address"), donor.email_address],
			[__("Phone"), donor.phone],
			[__("Address"), address],
		]
			.map(
				([label, value]) => `
				<div class="label">${this.escape(label)}</div>
				<div>${label === __("Address") ? value || "" : this.escape(value || "")}</div>
			`
			)
			.join("");
		const statusDetails = donor.contact_status_details?.trim();
		const statusDetailsHtml = statusDetails
			? `<div class="donor-status-details mb-4">
				<div class="text-muted mb-2">${this.escape(__("Status Details"))}</div>
				<div style="white-space: pre-wrap; overflow-wrap: anywhere;">${this.escape(statusDetails)}</div>
			</div>`
			: "";
		return `${statusDetailsHtml}<div class="donor-contact-grid">${rows}</div>`;
	}

	async submit_change_request(dialog, donor, values) {
		const changes = {};
		DONOR_CHANGE_FIELDS.forEach(([fieldname]) => {
			const currentValue = donor[fieldname] || null;
			const requestedValue = values[fieldname] || null;
			if (currentValue !== requestedValue) {
				changes[fieldname] = requestedValue;
			}
		});

		if (!Object.keys(changes).length) {
			frappe.msgprint(__("No contact changes were entered."));
			return;
		}

		await frappe.call({
			method: "verein.donation_management.supporter_donors.create_contact_change_request",
			args: {
				supporter: donor.name,
				cost_center: this.costCenterControl.get_value(),
				from_date: this.fromDateControl.get_value(),
				to_date: this.toDateControl.get_value(),
				changes,
			},
			freeze: true,
		});
		dialog.hide();
		frappe.show_alert({ message: __("Contact change request created."), indicator: "green" });
	}

	render_column_header(sortField, label, filterField) {
		const id = `donors-page-filter-${filterField}`;
		const filterLabel = this.escape_attr(__("Filter {0}", [label]));
		const input =
			filterField === "account"
				? `<select id="${id}" class="form-control column-filter-input" data-filter-field="${filterField}" aria-label="${filterLabel}" hidden></select>`
				: `<input id="${id}" type="search" class="form-control column-filter-input" data-filter-field="${filterField}" aria-label="${filterLabel}" placeholder="${this.escape_attr(
						__("Search")
				  )}" hidden>`;
		return `<div class="column-heading">
			${this.render_sort_header(sortField, label)}
			<button type="button" class="btn btn-xs column-filter-toggle" data-filter-field="${filterField}" aria-label="${filterLabel}" title="${filterLabel}" aria-controls="${id}" aria-expanded="false">
				${this.get_icon("filter")}
			</button>
		</div>${input}`;
	}

	bind_column_filters() {
		this.$tableShell.on("click", ".column-filter-toggle", (event) => {
			const field = $(event.currentTarget).data("filter-field");
			if (this.openColumnFilters.has(field)) {
				this.openColumnFilters.delete(field);
				if (this.columnFilters[field] || this.pendingColumnFilterField === field) {
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
		this.$tableShell.on("input", "input.column-filter-input", (event) =>
			this.change_column_filter(event, 300)
		);
		this.$tableShell.on("change", "select.column-filter-input", (event) =>
			this.change_column_filter(event, 0)
		);
	}

	change_column_filter(event, delay) {
		const field = $(event.currentTarget).data("filter-field");
		this.set_column_filter(field, event.currentTarget.value, delay);
	}

	set_column_filter(field, value, delay) {
		this.columnFilters[field] = value;
		this.sync_column_filters();
		this.invalidate_requests();
		clearTimeout(this.columnFilterTimeout);
		this.columnFilterTimeout = null;
		this.pendingColumnFilterField = null;
		if (delay) {
			this.pendingColumnFilterField = field;
			this.columnFilterTimeout = setTimeout(() => this.load_donors(true), delay);
		} else {
			this.load_donors(true);
		}
	}

	invalidate_requests() {
		++this.donorRequestGeneration;
		this.expandedDonors.clear();
		this.donorBookings = {};
		this.$loadMoreButton?.prop("disabled", true);
	}

	sync_column_filters() {
		if (!this.$tableBody) return;

		this.$tableShell.find(".column-filter-input").each((_, input) => {
			const field = $(input).data("filter-field");
			const value = this.columnFilters[field] || "";
			if (input.value !== value) $(input).val(value);
			input.hidden = !this.openColumnFilters.has(field);
		});
		this.$tableShell.find(".column-filter-toggle").each((_, button) => {
			const field = $(button).data("filter-field");
			$(button)
				.toggleClass("active", Boolean(this.columnFilters[field]?.trim()))
				.attr("aria-expanded", String(this.openColumnFilters.has(field)));
		});
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
		return this.load_donors(true);
	}

	format_currency(value) {
		return format_currency(flt(value || 0));
	}

	format_datetime(value) {
		if (!value) {
			return "";
		}
		return frappe.datetime.str_to_user(String(value).replace("T", " ").slice(0, 19));
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
