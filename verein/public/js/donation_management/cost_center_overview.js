import { DonationFilters } from "./filters.js";
import { DonationTableHeader } from "./table_header.js";
import { format_money, get_icon, render_kpis } from "./presentation.js";

export class CostCenterOverviewPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.data = null;
		this.chart = null;
		this.currentBalance = null;
		this.balanceByCostCenter = {};
		this.balancePromiseByCostCenter = {};
		this.dashboardRequestGeneration = 0;
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
		this.filters = new DonationFilters({
			on_invalidate: () => {
				++this.dashboardRequestGeneration;
			},
			on_change: (_values, changed) =>
				changed.some((field) => ["company", "cost_center"].includes(field))
					? this.load_cost_center_data()
					: this.load_dashboard(),
		});
		this.make_layout();
	}

	make_layout() {
		this.$root = $(
			'<div class="donation-management cost-center-overview d-flex flex-column m-2 m-sm-3">'
		).appendTo(this.page.main);
		this.filters.mount(this.$root);

		this.$emptyState = $('<div class="empty-state">').hide().appendTo(this.$root);
		this.$kpiGrid = $('<div class="kpi-grid">').appendTo(this.$root);
		this.$chartShell = $(`
			<div class="chart-shell">
				<div class="chart-series-controls"></div>
				<div class="chart"></div>
			</div>
		`).appendTo(this.$root);
		this.$tableShell = $('<div class="table-shell">').appendTo(this.$root);
		this.tableHeader = new DonationTableHeader(this.$tableShell[0]);
	}

	async refresh() {
		++this.dashboardRequestGeneration;

		const available = await this.filters.refresh();
		if (this.destroyed || available === null) return;
		if (!available) {
			this.show_empty(__("No cost centers have been shared with you yet."));
			return;
		}
		await this.load_cost_center_data();
	}

	async load_cost_center_data() {
		const costCenter = this.filters.costCenterControl.get_value();
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
			if (!this.destroyed && this.filters.costCenterControl.get_value() === costCenter) {
				this.currentBalance = balance;
				if (this.data) {
					this.render_kpis();
				}
			}
			return balance;
		} catch (error) {
			if (!this.destroyed && this.filters.costCenterControl.get_value() === costCenter) {
				this.currentBalance = null;
				frappe.msgprint(error.message || __("Balance could not be loaded."));
			}
			return null;
		} finally {
			delete this.balancePromiseByCostCenter[costCenter];
		}
	}

	async load_dashboard() {
		const costCenter = this.filters.costCenterControl.get_value();
		if (!costCenter) {
			return;
		}
		const requestGeneration = ++this.dashboardRequestGeneration;
		this.data = null;
		this.show_loading();

		try {
			const response = await frappe.call({
				method: "verein.donation_management.cost_center_dashboard.get_dashboard_data",
				args: {
					cost_center: costCenter,
					from_date: this.filters.fromDateControl.get_value(),
					to_date: this.filters.toDateControl.get_value(),
				},
			});
			if (requestGeneration !== this.dashboardRequestGeneration) {
				return;
			}
			this.data = response.message;
			this.render();
		} catch (error) {
			if (requestGeneration !== this.dashboardRequestGeneration) {
				return;
			}
			this.show_empty(error.message || __("Dashboard data could not be loaded."));
		}
	}

	show_loading() {
		this.$emptyState.hide();
		this.$kpiGrid.hide();
		this.$chartShell.hide();
		this.$tableShell
			.show()
			.html(
				`<div class="loading-state">${get_icon("loader-circle")}${__(
					"Loading data..."
				)}</div>`
			);
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
		render_kpis(
			this.$kpiGrid,
			items.map(([label, value]) => [label, this.format_kpi_currency(value)])
		);
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
		const visibleKeys = Object.keys(this.visibleChartSeries).filter(
			(key) => this.visibleChartSeries[key]
		);
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
					? `<button class="btn btn-xs btn-secondary edit-budget" data-from-date="${
							row.month_start
					  }" data-budget="${row.budget}">${get_icon("edit")}${__("Edit")}</button>`
					: "";
				return `
					<tr>
						<td class="month-cell">${frappe.utils.escape_html(row.label)}</td>
						<td class="amount-cell">${format_money(row.income)}</td>
						<td class="amount-cell">${format_money(row.expense)}</td>
						<td class="amount-cell">${this.format_signed_currency(row.net)}</td>
						<td class="amount-cell">
							<span class="budget-cell-content">
								<span>${format_money(row.budget)}</span>
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
									${get_icon("info")}
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
						cost_center: this.filters.costCenterControl.get_value(),
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
		return format_money(value);
	}

	format_signed_currency(value) {
		return this.wrap_amount_with_state(flt(value || 0), format_money(value));
	}

	format_budget_delta(row) {
		const delta = flt(row.income || 0) - flt(row.budget || 0);
		return this.wrap_amount_with_state(delta, format_money(delta));
	}

	wrap_amount_with_state(value, formattedValue) {
		const amountClass = value < 0 ? "amount-negative" : value > 0 ? "amount-positive" : "";
		if (!amountClass) {
			return formattedValue;
		}

		return `<span class="${amountClass}">${formattedValue}</span>`;
	}

	destroy() {
		this.destroyed = true;
		++this.dashboardRequestGeneration;
		this.filters.destroy();
		this.tableHeader.destroy();
		this.chart?.destroy?.();
		this.$root.remove();
	}
}
