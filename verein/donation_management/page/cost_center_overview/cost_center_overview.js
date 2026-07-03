frappe.provide("verein.donation_management");

const DATE_RANGE_PRESETS = {
	CUSTOM: __("Custom"),
	LAST_THREE_MONTHS: __("Last Three Months"),
	LAST_HALF_YEAR: __("Last Half Year"),
	LAST_YEAR: __("Last Year"),
	LAST_THREE_YEARS: __("Last Three Years"),
};
const COST_CENTER_OVERVIEW_FILTER_STORAGE_KEY = "verein.donation_management.cost_center_filters";

frappe.pages["cost-center-overview"].on_page_load = function (wrapper) {
	if (!wrapper.costCenterOverview) {
		wrapper.costCenterOverview = new verein.donation_management.CostCenterOverviewPage(wrapper);
	}
};

frappe.pages["cost-center-overview"].refresh = function (wrapper) {
	wrapper.costCenterOverview?.refresh();
};

verein.donation_management.CostCenterOverviewPage = class CostCenterOverviewPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.costCenters = [];
		this.data = null;
		this.chart = null;
		this.currentBalance = null;
		this.balanceByCostCenter = {};
		this.balancePromiseByCostCenter = {};
		this.visibleChartSeries = {
			income: true,
			expense: true,
			budget: true,
		};
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Cost Center Overview"),
			single_column: true,
		});
		this.inject_styles();
		this.make_controls();
		this.make_layout();
		this.refresh();
	}

	inject_styles() {
		if (document.getElementById("cost-center-overview-styles")) {
			return;
		}

		$(`<style id="cost-center-overview-styles">
			.cost-center-overview {
				gap: 16px;
				width: auto;
				max-width: none;
			}

			.cost-center-overview .filter-row {
				display: grid;
				grid-template-columns: minmax(180px, 300px) minmax(140px, 180px) minmax(120px, 150px) minmax(120px, 150px);
				gap: 12px;
				align-items: end;
				justify-content: start;
			}

			.cost-center-overview .filter-row > * {
				min-width: 0;
			}

			.cost-center-overview .form-group.frappe-control {
				margin-bottom: 0;
				padding-left: 0;
				padding-right: 0;
				width: 100%;
			}

			.cost-center-overview .control-input-wrapper,
			.cost-center-overview .control-input,
			.cost-center-overview .input-with-feedback,
			.cost-center-overview select {
				width: 100%;
				min-width: 0;
			}

			.cost-center-overview .edit-budget {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				gap: 6px;
				min-height: 32px;
				white-space: nowrap;
			}

			.cost-center-overview .kpi-grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
				gap: 12px;
			}

			.cost-center-overview .kpi {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
				padding: 14px 16px;
				min-width: 0;
			}

			.cost-center-overview .kpi-label {
				color: var(--text-muted);
				font-size: 0.75rem;
				font-weight: 600;
				text-transform: uppercase;
				margin-bottom: 0.35rem;
			}

			.cost-center-overview .kpi-value {
				font-size: 1.35rem;
				font-weight: 700;
				line-height: 1.25;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.cost-center-overview .chart-shell,
			.cost-center-overview .table-shell {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
			}

			.cost-center-overview .chart-shell {
				padding: 16px;
				min-height: 320px;
			}

			.cost-center-overview .chart-series-controls {
				display: flex;
				flex-wrap: wrap;
				gap: 8px;
				margin-bottom: 12px;
			}

			.cost-center-overview .chart-series-toggle {
				display: inline-flex;
				align-items: center;
				gap: 6px;
				min-height: 30px;
			}

			.cost-center-overview .chart-series-toggle[aria-pressed="false"] {
				opacity: 0.55;
			}

			.cost-center-overview .chart-series-swatch {
				width: 10px;
				height: 10px;
				border-radius: 50%;
				flex: 0 0 auto;
			}

			.cost-center-overview .table-shell {
				overflow-x: auto;
				overflow-y: hidden;
			}

			.cost-center-overview table {
				margin-bottom: 0;
				min-width: 680px;
			}

			.cost-center-overview td,
			.cost-center-overview th {
				vertical-align: middle;
			}

			.cost-center-overview .amount-cell {
				text-align: right;
				white-space: nowrap;
			}

			.cost-center-overview .table-header-label {
				display: inline-flex;
				align-items: center;
				justify-content: flex-end;
				gap: 6px;
			}

			.cost-center-overview .info-icon-button {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				padding: 0;
				border: 0;
				background: transparent;
				color: var(--text-muted);
				cursor: help;
			}

			.cost-center-overview .amount-positive {
				color: var(--green-700);
				font-weight: 600;
			}

			.cost-center-overview .amount-negative {
				color: var(--red-600);
				font-weight: 600;
			}

			.cost-center-overview .month-cell {
				white-space: nowrap;
			}

			.cost-center-overview .budget-action {
				text-align: right;
				width: 1%;
				white-space: nowrap;
			}

			.cost-center-overview .budget-cell-content {
				display: inline-flex;
				align-items: center;
				justify-content: flex-end;
				gap: 8px;
				white-space: nowrap;
			}

			.cost-center-overview .empty-state {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
				padding: 32px;
				color: var(--text-muted);
				text-align: center;
			}

			@media (max-width: 900px) {
				.cost-center-overview .filter-row,
				.cost-center-overview .kpi-grid {
					grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
				}
			}

			@media (max-width: 560px) {
				.cost-center-overview .filter-row,
				.cost-center-overview .kpi-grid {
					grid-template-columns: minmax(0, 1fr);
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
			options: Object.values(DATE_RANGE_PRESETS),
			default: DATE_RANGE_PRESETS.LAST_HALF_YEAR,
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
		this.$root = $('<div class="cost-center-overview d-flex flex-column m-2 m-sm-3">').appendTo(this.page.main);
		this.$filterRow = $('<div class="filter-row">').appendTo(this.$root);
		this.$filterRow.append(this.costCenterControl.$wrapper);
		this.$filterRow.append(this.dateRangeControl.$wrapper);
		this.$filterRow.append(this.fromDateControl.$wrapper);
		this.$filterRow.append(this.toDateControl.$wrapper);

		this.$emptyState = $('<div class="empty-state">').hide().appendTo(this.$root);
		this.$kpiGrid = $('<div class="kpi-grid">').appendTo(this.$root);
		this.$chartShell = $(`
			<div class="chart-shell">
				<div class="chart-series-controls"></div>
				<div class="chart"></div>
			</div>
		`).appendTo(this.$root);
		this.$tableShell = $('<div class="table-shell">').appendTo(this.$root);
	}

	handle_cost_center_change() {
		if (this.restoringFilters) {
			return;
		}
		this.store_filters();
		this.load_cost_center_data();
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
		this.dateRefreshTimeout = setTimeout(() => this.load_dashboard(), 150);
	}

	async mark_custom_date_range() {
		if (this.applyingDateRangePreset || this.dateRangeControl.get_value() === DATE_RANGE_PRESETS.CUSTOM) {
			return;
		}
		if (this.current_dates_match_selected_preset()) {
			return;
		}
		this.restoringFilters = true;
		try {
			await this.dateRangeControl.set_value(DATE_RANGE_PRESETS.CUSTOM);
		} finally {
			this.restoringFilters = false;
		}
	}

	async apply_date_range_preset() {
		const selectedRange = this.dateRangeControl.get_value();
		if (!selectedRange || selectedRange === DATE_RANGE_PRESETS.CUSTOM) {
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
		await this.load_dashboard();
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
			[DATE_RANGE_PRESETS.LAST_THREE_MONTHS]: 3,
			[DATE_RANGE_PRESETS.LAST_HALF_YEAR]: 6,
			[DATE_RANGE_PRESETS.LAST_YEAR]: 12,
			[DATE_RANGE_PRESETS.LAST_THREE_YEARS]: 36,
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
			const filters = JSON.parse(sessionStorage.getItem(COST_CENTER_OVERVIEW_FILTER_STORAGE_KEY) || "null");
			return filters && typeof filters === "object" ? filters : null;
		} catch {
			return null;
		}
	}

	store_filters() {
		try {
			sessionStorage.setItem(
				COST_CENTER_OVERVIEW_FILTER_STORAGE_KEY,
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
		return Object.values(DATE_RANGE_PRESETS).includes(storedPeriod) ? storedPeriod : null;
	}

	has_stored_dates(storedFilters) {
		return Boolean(storedFilters?.from_date && storedFilters?.to_date);
	}

	async restore_filters(options) {
		const storedFilters = this.get_stored_filters();
		const costCenter = this.get_valid_stored_cost_center(options, storedFilters) || options[0].value;
		const hasStoredDates = this.has_stored_dates(storedFilters);
		let period = this.get_valid_stored_period(storedFilters) || DATE_RANGE_PRESETS.LAST_HALF_YEAR;
		if (period === DATE_RANGE_PRESETS.CUSTOM && !hasStoredDates) {
			period = DATE_RANGE_PRESETS.LAST_HALF_YEAR;
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
			label: row.cost_center_name || row.name,
			value: row.name,
		}));
		this.costCenterControl.df.options = options;
		this.costCenterControl.refresh();

		if (!options.length) {
			this.show_empty(__("No cost centers have been shared with you yet."));
			return;
		}

		await this.restore_filters(options);
		await this.load_cost_center_data();
	}

	async load_cost_center_data() {
		const costCenter = this.costCenterControl.get_value();
		if (!costCenter) {
			return;
		}

		this.data = null;
		this.currentBalance = Object.hasOwn(this.balanceByCostCenter, costCenter)
			? this.balanceByCostCenter[costCenter]
			: null;
		await Promise.all([this.load_dashboard(), this.load_balance(costCenter)]);
	}

	async load_balance(costCenter) {
		if (Object.hasOwn(this.balanceByCostCenter, costCenter)) {
			this.currentBalance = this.balanceByCostCenter[costCenter];
			if (this.data) {
				this.render_kpis();
			}
			return this.currentBalance;
		}

		if (!this.balancePromiseByCostCenter[costCenter]) {
			this.balancePromiseByCostCenter[costCenter] = (async () => {
				const response = await frappe.call({
					method: "verein.donation_management.cost_center_dashboard.get_cost_center_balance",
					args: { cost_center: costCenter },
				});
				this.balanceByCostCenter[costCenter] = flt(response.message || 0);
				return this.balanceByCostCenter[costCenter];
			})();
		}

		try {
			const balance = await this.balancePromiseByCostCenter[costCenter];
			if (this.costCenterControl.get_value() === costCenter) {
				this.currentBalance = balance;
				if (this.data) {
					this.render_kpis();
				}
			}
			return balance;
		} catch (error) {
			if (this.costCenterControl.get_value() === costCenter) {
				this.currentBalance = null;
				frappe.msgprint(error.message || __("Balance could not be loaded."));
			}
			return null;
		} finally {
			delete this.balancePromiseByCostCenter[costCenter];
		}
	}

	async load_dashboard() {
		const costCenter = this.costCenterControl.get_value();
		if (!costCenter) {
			return;
		}

		try {
			const response = await frappe.call({
				method: "verein.donation_management.cost_center_dashboard.get_dashboard_data",
				args: {
					cost_center: costCenter,
					from_date: this.fromDateControl.get_value(),
					to_date: this.toDateControl.get_value(),
				},
				freeze: true,
			});
			this.data = response.message;
			this.render();
		} catch (error) {
			this.show_empty(error.message || __("Dashboard data could not be loaded."));
		}
	}

	render() {
		this.$emptyState.hide();
		this.$kpiGrid.show();
		this.$chartShell.show();
		this.$tableShell.show();
		this.render_kpis();
		this.render_chart();
		this.render_table();
	}

	show_empty(message) {
		this.$emptyState.text(message).show();
		this.$kpiGrid.hide();
		this.$chartShell.hide();
		this.$tableShell.hide();
	}

	render_kpis() {
		const summary = this.data.summary || {};
		const items = [
			[__("Balance"), this.currentBalance],
			[__("Income"), summary.income],
			[__("Expense"), summary.expense],
			[__("Net"), summary.net],
		];
		this.$kpiGrid.empty();
		items.forEach(([label, value]) => {
			$(`
				<div class="kpi">
					<div class="kpi-label">${frappe.utils.escape_html(label)}</div>
					<div class="kpi-value">${this.format_kpi_currency(value)}</div>
				</div>
			`).appendTo(this.$kpiGrid);
		});
	}

	render_chart() {
		const months = this.data.months || [];
		const series = this.get_chart_series(months);
		let visibleSeries = series.filter((item) => this.visibleChartSeries[item.key]);
		if (!visibleSeries.length && series.length) {
			this.visibleChartSeries[series[0].key] = true;
			visibleSeries = [series[0]];
		}
		const chartData = {
			labels: months.map((row) => row.label),
			datasets: visibleSeries.map((item) => ({
				name: item.label,
				values: item.values,
			})),
		};

		this.render_chart_controls(series);
		this.$chartShell.find(".chart").empty();
		this.chart = new frappe.Chart(this.$chartShell.find(".chart")[0], {
			title: null,
			data: chartData,
			type: "axis-mixed",
			height: 280,
			colors: visibleSeries.map((item) => item.color),
			showLegend: 0,
			axisOptions: { xAxisMode: "tick" },
			barOptions: { stacked: false },
			lineOptions: { regionFill: 0 },
		});
	}

	get_chart_series(months) {
		return [
			{
				key: "income",
				label: __("Income"),
				color: "#2f9e44",
				values: months.map((row) => row.income),
			},
			{
				key: "expense",
				label: __("Expense"),
				color: "#e03131",
				values: months.map((row) => row.expense),
			},
			{
				key: "budget",
				label: __("Budget"),
				color: "#f08c00",
				values: months.map((row) => row.budget),
			},
		];
	}

	render_chart_controls(series) {
		const $controls = this.$chartShell.find(".chart-series-controls").empty();
		series.forEach((item) => {
			const isVisible = Boolean(this.visibleChartSeries[item.key]);
			const label = frappe.utils.escape_html(item.label);
			const ariaLabel = frappe.utils.escape_html(__("Show or hide {0}", [item.label]));
			const $button = $(`
				<button
					type="button"
					class="btn btn-xs btn-secondary chart-series-toggle"
					data-series="${item.key}"
					aria-pressed="${isVisible ? "true" : "false"}"
					aria-label="${ariaLabel}"
					title="${ariaLabel}"
				>
					<span class="chart-series-swatch" style="background-color: ${item.color};"></span>
					<span>${label}</span>
				</button>
			`);
			$button.on("click", () => this.toggle_chart_series(item.key));
			$controls.append($button);
		});
	}

	toggle_chart_series(seriesKey) {
		const visibleKeys = Object.keys(this.visibleChartSeries).filter((key) => this.visibleChartSeries[key]);
		if (this.visibleChartSeries[seriesKey] && visibleKeys.length <= 1) {
			return;
		}

		this.visibleChartSeries[seriesKey] = !this.visibleChartSeries[seriesKey];
		this.render_chart();
	}

	render_table() {
		const canManageBudget = Boolean(this.data.can_manage_budget);
		const budgetDeltaHelpText = __(
			"Budget Delta shows the difference between income and budget."
		);
		const rows = (this.data.months || [])
			.slice()
			.sort((a, b) => (b.month || "").localeCompare(a.month || ""))
			.map((row) => {
				const budgetAction = canManageBudget
					? `<button class="btn btn-xs btn-secondary edit-budget" data-from-date="${row.month_start}" data-budget="${row.budget}">${this.get_icon("edit")}${__("Edit")}</button>`
					: "";
				return `
					<tr>
						<td class="month-cell">${frappe.utils.escape_html(row.label)}</td>
						<td class="amount-cell">${this.format_currency(row.income)}</td>
						<td class="amount-cell">${this.format_currency(row.expense)}</td>
						<td class="amount-cell">${this.format_signed_currency(row.net)}</td>
						<td class="amount-cell">
							<span class="budget-cell-content">
								<span>${this.format_currency(row.budget)}</span>
								${budgetAction}
							</span>
						</td>
						<td class="amount-cell">${this.format_budget_delta(row)}</td>
					</tr>
				`;
			})
			.join("");

		this.$tableShell.html(`
			<table class="table table-bordered">
				<thead>
					<tr>
						<th class="month-cell">${__("Month")}</th>
						<th class="amount-cell">${__("Income")}</th>
						<th class="amount-cell">${__("Expense")}</th>
						<th class="amount-cell">${__("Net")}</th>
						<th class="amount-cell">${__("Budget")}</th>
						<th class="amount-cell">
							<span class="table-header-label">
								<span>${__("Budget Delta")}</span>
								<button
									type="button"
									class="info-icon-button"
									data-toggle="tooltip"
									data-placement="top"
									title="${frappe.utils.escape_html(budgetDeltaHelpText)}"
									aria-label="${frappe.utils.escape_html(budgetDeltaHelpText)}"
								>
									${this.get_icon("info")}
								</button>
							</span>
						</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		`);
		this.$tableShell.find(".edit-budget").on("click", (event) => {
			const $button = $(event.currentTarget);
			this.open_budget_dialog($button.data("from-date"), $button.data("budget"));
		});
		this.$tableShell.find('[data-toggle="tooltip"]').tooltip({ container: "body" });
	}

	open_budget_dialog(fromDate, currentBudget) {
		const dialog = new frappe.ui.Dialog({
			title: __("Edit Budget"),
			fields: [
				{
					fieldname: "from_date",
					fieldtype: "Date",
					label: __("From Date"),
					default: fromDate,
					reqd: 1,
				},
				{
					fieldname: "budget_amount",
					fieldtype: "Currency",
					label: __("Budget Amount"),
					default: currentBudget,
					reqd: 1,
				},
			],
			primary_action_label: __("Save"),
			primary_action: async (values) => {
				await frappe.call({
					method: "verein.donation_management.cost_center_dashboard.upsert_budget",
					args: {
						cost_center: this.costCenterControl.get_value(),
						from_date: values.from_date,
						budget_amount: values.budget_amount,
					},
				});
				dialog.hide();
				await this.load_dashboard();
			},
		});
		dialog.show();
	}

	format_kpi_currency(value) {
		if (value === null || value === undefined) {
			return "...";
		}
		return this.format_currency(value);
	}

	format_currency(value) {
		return format_currency(flt(value || 0));
	}

	format_signed_currency(value) {
		return this.wrap_amount_with_state(flt(value || 0), this.format_currency(value));
	}

	format_budget_delta(row) {
		const delta = flt(row.income || 0) - flt(row.budget || 0);
		return this.wrap_amount_with_state(delta, this.format_currency(delta));
	}

	wrap_amount_with_state(value, formattedValue) {
		const amountClass = value < 0 ? "amount-negative" : value > 0 ? "amount-positive" : "";
		if (!amountClass) {
			return formattedValue;
		}

		return `<span class="${amountClass}">${formattedValue}</span>`;
	}

	get_icon(icon) {
		return frappe.utils.icon(icon, "sm");
	}
};
