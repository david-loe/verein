import { DonationFilters } from "./filters.js";
import { DonationTableHeader } from "./table_header.js";
import { escape_html, escape_attr, format_money, render_kpis, LoadMore } from "./presentation.js";
import { DonationTableControls } from "./table_controls.js";

const BOOKING_PAGE_LENGTH = 200;

export class CostCenterBookingsPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.entries = [];
		this.summary = {};
		this.hasMore = false;
		this.nextLimitStart = 0;
		this.bookingRequestGeneration = 0;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Bookings"),
			single_column: true,
		});
		this.filters = new DonationFilters({
			on_invalidate: () => {
				this.invalidate_requests();
				this.tableControls?.cancel_pending();
			},
			on_change: () => this.load_bookings(true),
		});
		this.make_layout();
	}

	make_layout() {
		this.$root = $(
			'<div class="donation-management donation-list-page cost-center-bookings d-flex flex-column m-2 m-sm-3">'
		).appendTo(this.page.main);
		this.filters.mount(this.$root);

		this.$emptyState = $('<div class="empty-state">').hide().appendTo(this.$root);
		this.$kpiGrid = $('<div class="kpi-grid">').appendTo(this.$root);
		this.$tableShell = $('<div class="table-shell">').appendTo(this.$root);
		this.tableHeader = new DonationTableHeader(this.$tableShell[0]);
		this.tableControls = new DonationTableControls({
			shell: this.$tableShell,
			id: "cost-center-bookings",
			fields: { remarks: { type: "Data" }, account: { type: "Select" } },
			on_invalidate: () => {
				this.filters.cancel_pending();
				this.invalidate_requests();
			},
			on_change: () => this.load_bookings(true),
		});
		this.loadMore = new LoadMore(this.$root, () => this.load_bookings(false));
	}

	get_booking_filter_context() {
		return JSON.stringify([
			this.filters.companyControl.get_value(),
			this.filters.costCenterControl.get_value(),
			this.filters.fromDateControl.get_value(),
			this.filters.toDateControl.get_value(),
		]);
	}

	sync_booking_filter_context() {
		const context = this.get_booking_filter_context();
		if (this.bookingFilterContext !== context) {
			this.tableControls.filters.account = "";
			this.accountOptions = [];
			this.bookingFilterContext = context;
			this.sync_column_filters();
		}
	}

	async refresh() {
		this.invalidate_requests();
		this.tableControls.cancel_pending();
		const available = await this.filters.refresh();
		if (this.destroyed || available === null) return;
		if (!available) {
			this.show_empty(__("No cost centers have been shared with you yet."));
			return;
		}
		await this.load_bookings(true);
	}

	async load_bookings(reset) {
		this.tableControls.cancel_pending();
		this.filters.cancel_pending();
		this.sync_booking_filter_context();
		const costCenter = this.filters.costCenterControl.get_value();
		if (!costCenter) {
			return;
		}
		const requestGeneration = ++this.bookingRequestGeneration;

		if (reset) {
			this.entries = [];
			this.summary = {};
			this.nextLimitStart = 0;
			this.hasMore = false;
			this.loadMore.$row.hide();
			this.show_loading();
		}

		this.loadMore.set_loading(true);
		try {
			const response = await frappe.call({
				method: "verein.donation_management.cost_center_bookings.get_booking_entries",
				args: {
					cost_center: costCenter,
					from_date: this.filters.fromDateControl.get_value(),
					to_date: this.filters.toDateControl.get_value(),
					limit_start: reset ? 0 : this.nextLimitStart,
					limit: BOOKING_PAGE_LENGTH,
					remarks: this.tableControls.filters.remarks,
					account: this.tableControls.filters.account,
					order_by: this.tableControls.sort?.field || "posting_date",
					order_direction: this.tableControls.sort?.direction || "desc",
				},
			});
			if (requestGeneration !== this.bookingRequestGeneration) {
				return;
			}
			const data = response.message || {};
			this.accountOptions = data.account_options || [];
			if (
				this.tableControls.filters.account &&
				!this.accountOptions.some(
					(row) => row.account === this.tableControls.filters.account
				)
			) {
				this.tableControls.filters.account = "";
				this.sync_column_filters();
				await this.load_bookings(true);
				return;
			}
			this.summary = data.summary || {};
			this.hasMore = Boolean(data.has_more);
			this.nextLimitStart = data.next_limit_start || 0;
			this.entries = reset ? data.entries || [] : this.entries.concat(data.entries || []);
			this.render();
		} catch (error) {
			if (requestGeneration !== this.bookingRequestGeneration) {
				return;
			}
			this.show_table_message(error.message || __("Bookings could not be loaded."));
		} finally {
			if (requestGeneration === this.bookingRequestGeneration) {
				this.loadMore.set_loading(false);
			}
		}
	}

	show_loading() {
		this.show_table_message(__("Loading data..."));
	}

	show_table_message(message) {
		this.$emptyState.hide();
		this.$kpiGrid.hide();
		this.loadMore.$row.hide();
		this.$tableShell.show();
		this.render_table();
		this.$tableBody.html(
			`<tr><td colspan="4" class="table-empty-state">${escape_html(message)}</td></tr>`
		);
	}

	render() {
		this.$emptyState.hide();
		this.$kpiGrid.show();
		this.$tableShell.show();
		this.render_kpis();
		this.render_table();
		this.loadMore.$row.toggle(this.hasMore);
	}

	show_empty(message) {
		this.$emptyState.text(message).show();
		this.$kpiGrid.hide();
		this.$tableShell.hide();
		this.loadMore.$row.hide();
	}

	render_kpis() {
		const items = [
			[__("Income"), this.summary.income],
			[__("Expense"), this.summary.expense],
			[__("Net"), this.summary.net],
		];
		render_kpis(
			this.$kpiGrid,
			items.map(([label, value]) => [label, format_money(value)])
		);
	}

	render_table() {
		const rows = this.entries.map((row) => this.render_row(row)).join("");
		if (!this.$tableBody) {
			this.$tableShell.html(`
			<table class="table table-bordered">
				<thead>
					<tr>
						<th class="date-cell">${this.tableControls.render_sort_header("posting_date", __("Date"))}</th>
						<th class="amount-cell">${this.tableControls.render_sort_header("net", __("Donation Amount"))}</th>
						<th>${this.tableControls.render_column_header("remarks", __("Remarks"), "remarks")}</th>
						<th>${this.tableControls.render_column_header("account", __("Account"), "account")}</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		`);
			this.$tableBody = this.$tableShell.find("table > tbody").first();
		}
		this.sync_column_filters();

		this.$tableBody.html(
			rows ||
				`<tr><td colspan="4" class="table-empty-state">${__(
					"No bookings found for the selected filters."
				)}</td></tr>`
		);
	}

	render_row(row) {
		return `
			<tr>
				<td class="date-cell">${frappe.datetime.str_to_user(row.posting_date)}</td>
				<td class="amount-cell">${format_money(row.net)}</td>
				<td class="remarks-cell" title="${escape_attr(row.remarks || "")}">${escape_html(
			row.remarks || ""
		)}</td>
				<td>${escape_html(row.account_name || row.account)}</td>
			</tr>
		`;
	}

	invalidate_requests() {
		++this.bookingRequestGeneration;
		this.loadMore?.$button.prop("disabled", true);
	}

	destroy() {
		this.destroyed = true;
		this.invalidate_requests();
		this.filters.destroy();
		this.tableHeader.destroy();
		this.tableControls.destroy();
		this.loadMore.destroy();
		this.$root.remove();
	}

	sync_column_filters() {
		this.tableControls.set_options(
			"account",
			(this.accountOptions || []).map((row) => ({
				value: row.account,
				label: row.account_name || row.account,
			})),
			__("All Accounts")
		);
		this.tableControls.sync_column_filters();
	}
}
