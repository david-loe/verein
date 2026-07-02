frappe.provide("verein.donation_management");

const DATE_RANGE_PRESETS = {
	CUSTOM: __("Custom"),
	LAST_THREE_MONTHS: __("Last Three Months"),
	LAST_HALF_YEAR: __("Last Half Year"),
	LAST_YEAR: __("Last Year"),
	LAST_THREE_YEARS: __("Last Three Years"),
};

frappe.pages["my-cost-centers"].on_page_load = function (wrapper) {
	if (!wrapper.myCostCenters) {
		wrapper.myCostCenters = new verein.donation_management.MyCostCentersPage(wrapper);
	}
};

frappe.pages["my-cost-centers"].refresh = function (wrapper) {
	wrapper.myCostCenters?.refresh();
};

verein.donation_management.MyCostCentersPage = class MyCostCentersPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.costCenters = [];
		this.data = null;
		this.chart = null;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Meine Kostenstellen"),
			single_column: true,
		});
		this.inject_styles();
		this.make_controls();
		this.make_layout();
		this.refresh();
	}

	inject_styles() {
		if (document.getElementById("my-cost-centers-styles")) {
			return;
		}

		$(`<style id="my-cost-centers-styles">
			.my-cost-centers {
				display: flex;
				flex-direction: column;
				gap: 1rem;
			}

			.my-cost-centers .filter-row {
				display: grid;
				grid-template-columns: minmax(220px, 1.3fr) minmax(160px, 0.8fr) minmax(140px, 0.7fr) minmax(140px, 0.7fr) auto;
				gap: 0.75rem;
				align-items: end;
			}

			.my-cost-centers .form-group.frappe-control {
				margin-bottom: 0;
				padding-left: 0;
				padding-right: 0;
				width: 100%;
			}

			.my-cost-centers .kpi-grid {
				display: grid;
				grid-template-columns: repeat(4, minmax(150px, 1fr));
				gap: 0.75rem;
			}

			.my-cost-centers .kpi {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
				padding: 0.85rem 1rem;
				min-width: 0;
			}

			.my-cost-centers .kpi-label {
				color: var(--text-muted);
				font-size: 0.75rem;
				font-weight: 600;
				text-transform: uppercase;
				margin-bottom: 0.35rem;
			}

			.my-cost-centers .kpi-value {
				font-size: 1.35rem;
				font-weight: 700;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.my-cost-centers .chart-shell,
			.my-cost-centers .table-shell,
			.my-cost-centers .empty-state {
				border: 1px solid var(--border-color);
				border-radius: 8px;
				background: var(--card-bg);
			}

			.my-cost-centers .chart-shell {
				padding: 1rem;
				min-height: 320px;
			}

			.my-cost-centers .table-shell {
				overflow-x: auto;
			}

			.my-cost-centers table {
				margin-bottom: 0;
				min-width: 720px;
			}

			.my-cost-centers td,
			.my-cost-centers th {
				vertical-align: middle;
			}

			.my-cost-centers .amount-cell {
				text-align: right;
				white-space: nowrap;
			}

			.my-cost-centers .budget-action {
				text-align: right;
				width: 1%;
				white-space: nowrap;
			}

			.my-cost-centers .empty-state {
				padding: 2rem;
				color: var(--text-muted);
				text-align: center;
			}

			@media (max-width: 900px) {
				.my-cost-centers .filter-row,
				.my-cost-centers .kpi-grid {
					grid-template-columns: 1fr 1fr;
				}
			}

			@media (max-width: 560px) {
				.my-cost-centers .filter-row,
				.my-cost-centers .kpi-grid {
					grid-template-columns: 1fr;
				}

				.my-cost-centers .filter-row .btn {
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
			change: () => this.load_dashboard(),
		});
		this.dateRangeControl = this.make_control({
			fieldtype: "Select",
			label: __("Period"),
			fieldname: "date_range",
			options: Object.values(DATE_RANGE_PRESETS),
			default: DATE_RANGE_PRESETS.CUSTOM,
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
		this.$root = $('<div class="my-cost-centers">').appendTo(this.page.main);
		this.$filterRow = $('<div class="filter-row">').appendTo(this.$root);
		this.$filterRow.append(this.costCenterControl.$wrapper);
		this.$filterRow.append(this.dateRangeControl.$wrapper);
		this.$filterRow.append(this.fromDateControl.$wrapper);
		this.$filterRow.append(this.toDateControl.$wrapper);
		this.$refreshButton = $(`<button class="btn btn-primary">${__("Refresh")}</button>`)
			.on("click", () => this.load_dashboard())
			.appendTo(this.$filterRow);

		this.$emptyState = $('<div class="empty-state">').hide().appendTo(this.$root);
		this.$kpiGrid = $('<div class="kpi-grid">').appendTo(this.$root);
		this.$chartShell = $('<div class="chart-shell"><div class="chart"></div></div>').appendTo(this.$root);
		this.$tableShell = $('<div class="table-shell">').appendTo(this.$root);
	}

	mark_custom_date_range() {
		if (this.applyingDateRangePreset || this.dateRangeControl.get_value() === DATE_RANGE_PRESETS.CUSTOM) {
			return;
		}
		if (this.current_dates_match_selected_preset()) {
			return;
		}
		this.dateRangeControl.set_value(DATE_RANGE_PRESETS.CUSTOM);
	}

	apply_date_range_preset() {
		const selectedRange = this.dateRangeControl.get_value();
		if (!selectedRange || selectedRange === DATE_RANGE_PRESETS.CUSTOM) {
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
		this.load_dashboard();
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
		await this.load_dashboard();
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
			[__("Balance"), summary.net],
			[__("Income"), summary.income],
			[__("Expense"), summary.expense],
			[__("Budget Delta"), summary.budget_delta],
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

	render_chart() {
		const months = this.data.months || [];
		const chartData = {
			labels: months.map((row) => row.label),
			datasets: [
				{name: __("Income"), values: months.map((row) => row.income)},
				{name: __("Expense"), values: months.map((row) => row.expense)},
				{name: __("Net"), values: months.map((row) => row.net)},
				{name: __("Budget"), values: months.map((row) => row.budget)},
			],
		};

		this.$chartShell.find(".chart").empty();
		this.chart = new frappe.Chart(this.$chartShell.find(".chart")[0], {
			title: null,
			data: chartData,
			type: "axis-mixed",
			height: 280,
			colors: ["#2f9e44", "#e03131", "#1971c2", "#f08c00"],
			axisOptions: {xAxisMode: "tick"},
			barOptions: {stacked: false},
			lineOptions: {regionFill: 0},
		});
	}

	render_table() {
		const canManageBudget = Boolean(this.data.can_manage_budget);
		const actionHeader = canManageBudget ? `<th class="budget-action"></th>` : "";
		const rows = (this.data.months || [])
			.map((row) => {
				const action = canManageBudget
					? `<td class="budget-action"><button class="btn btn-xs btn-secondary edit-budget" data-from-date="${row.month_start}" data-budget="${row.budget}">${__("Edit")}</button></td>`
					: "";
				return `
					<tr>
						<td>${frappe.utils.escape_html(row.label)}</td>
						<td class="amount-cell">${this.format_currency(row.income)}</td>
						<td class="amount-cell">${this.format_currency(row.expense)}</td>
						<td class="amount-cell">${this.format_currency(row.net)}</td>
						<td class="amount-cell">${this.format_currency(row.budget)}</td>
						<td class="amount-cell">${this.format_currency(row.budget_delta)}</td>
						${action}
					</tr>
				`;
			})
			.join("");

		this.$tableShell.html(`
			<table class="table table-bordered">
				<thead>
					<tr>
						<th>${__("Month")}</th>
						<th class="amount-cell">${__("Income")}</th>
						<th class="amount-cell">${__("Expense")}</th>
						<th class="amount-cell">${__("Net")}</th>
						<th class="amount-cell">${__("Budget")}</th>
						<th class="amount-cell">${__("Delta")}</th>
						${actionHeader}
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		`);
		this.$tableShell.find(".edit-budget").on("click", (event) => {
			const $button = $(event.currentTarget);
			this.open_budget_dialog($button.data("from-date"), $button.data("budget"));
		});
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

	format_currency(value) {
		return format_currency(flt(value || 0));
	}
};
