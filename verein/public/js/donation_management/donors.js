import { DonationFilters } from "./filters.js";
import { DonationTableHeader } from "./table_header.js";
import {
	escape_html,
	escape_attr,
	format_money,
	get_icon,
	render_kpis,
	LoadMore,
} from "./presentation.js";
import { DonationTableControls } from "./table_controls.js";

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

export class DonorsPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.donors = [];
		this.summary = {};
		this.hasMore = false;
		this.nextLimitStart = 0;
		this.expandedDonors = new Set();
		this.donorBookings = {};
		this.donorRequestGeneration = 0;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Donors"),
			single_column: true,
		});
		this.filters = new DonationFilters({
			on_invalidate: () => {
				this.invalidate_requests();
				this.tableControls?.cancel_pending();
			},
			on_change: () => this.load_donors(true),
		});
		this.make_layout();
	}

	make_layout() {
		this.$root = $(
			'<div class="donation-management donation-list-page donors-page d-flex flex-column m-2 m-sm-3">'
		).appendTo(this.page.main);
		this.filters.mount(this.$root);

		this.$emptyState = $('<div class="empty-state">').hide().appendTo(this.$root);
		this.$kpiGrid = $('<div class="kpi-grid">').appendTo(this.$root);
		this.$tableShell = $('<div class="table-shell">').appendTo(this.$root);
		this.tableHeader = new DonationTableHeader(this.$tableShell[0]);
		this.tableControls = new DonationTableControls({
			shell: this.$tableShell,
			id: "donors-page",
			fields: { search: { type: "Data" } },
			on_invalidate: () => {
				this.filters.cancel_pending();
				this.invalidate_requests();
			},
			on_change: () => this.load_donors(true),
		});
		this.loadMore = new LoadMore(this.$root, () => this.load_donors(false));
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
		await this.load_donors(true);
	}

	async load_donors(reset) {
		this.tableControls.cancel_pending();
		this.filters.cancel_pending();
		const costCenter = this.filters.costCenterControl.get_value();
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
			this.loadMore.$row.hide();
			this.show_loading();
		}

		this.loadMore.set_loading(true);
		try {
			const response = await frappe.call({
				method: "verein.donation_management.supporter_donors.get_donors",
				args: {
					cost_center: costCenter,
					from_date: this.filters.fromDateControl.get_value(),
					to_date: this.filters.toDateControl.get_value(),
					search: this.tableControls.filters.search,
					limit_start: reset ? 0 : this.nextLimitStart,
					limit: DONOR_PAGE_LENGTH,
					order_by: this.tableControls.sort?.field || "amount",
					order_direction: this.tableControls.sort?.direction || "desc",
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
			`<tr><td colspan="7" class="table-empty-state">${escape_html(message)}</td></tr>`
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
			[__("Donors"), this.summary.donor_count || 0],
			[__("Donation Amount"), format_money(this.summary.amount)],
		];
		render_kpis(
			this.$kpiGrid,
			items.map(([label, value]) => [
				label,
				typeof value === "number" ? escape_html(String(value)) : value,
			])
		);
	}

	render_table() {
		const rows = this.donors.map((row) => this.render_row(row)).join("");
		if (!this.$tableBody) {
			this.$tableShell.html(`
			<table class="table table-bordered">
				<thead>
					<tr>
						<th class="expand-cell"></th>
						<th>${this.tableControls.render_column_header("full_name", __("Donor"), "search")}</th>
						<th class="amount-cell">${this.tableControls.render_sort_header(
							"amount",
							__("Donation Amount")
						)}</th>
						<th class="count-cell">${this.tableControls.render_sort_header(
							"booking_count",
							__("Bookings")
						)}</th>
						<th class="date-cell">${this.tableControls.render_sort_header(
							"first_donation_date",
							__("First Donation")
						)}</th>
						<th class="date-cell">${this.tableControls.render_sort_header(
							"last_donation_date",
							__("Last Donation")
						)}</th>
						<th class="datetime-cell">${this.tableControls.render_sort_header(
							"contact_or_address_modified",
							__("Address Modified")
						)}</th>
					</tr>
				</thead>
				<tbody></tbody>
			</table>
		`);
			this.$tableBody = this.$tableShell.find("table > tbody").first();
		}
		this.tableControls.sync_column_filters();

		this.$tableBody.html(
			rows ||
				`<tr><td colspan="7" class="table-empty-state">${__(
					"No donors found for the selected filters."
				)}</td></tr>`
		);
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
			<tr class="donor-row" data-donor-name="${escape_attr(row.name)}">
				<td class="expand-cell">
					<button type="button" class="btn btn-xs btn-secondary expand-button" data-donor-name="${escape_attr(
						row.name
					)}" title="${escape_attr(expanded ? __("Collapse") : __("Expand"))}">
						${get_icon(expanded ? "chevron-down" : "chevron-right")}
					</button>
				</td>
				<td class="donor-cell">
					<div class="donor-cell-content">
						<span class="donor-identity">
							<span class="donor-name">${escape_html(row.full_name || row.name)}</span>
							${this.render_donor_status(row)}
						</span>
						<button type="button" class="btn btn-xs btn-secondary contact-button" data-donor-name="${escape_attr(
							row.name
						)}">
							${get_icon("contact")}${__("Contact")}
						</button>
					</div>
				</td>
				<td class="amount-cell">${format_money(row.amount)}</td>
				<td class="count-cell">${escape_html(String(row.booking_count || 0))}</td>
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
				<td class="datetime-cell">${escape_html(
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
		return `<span class="donor-status indicator-pill ${escape_attr(color)} no-indicator-dot"
			title="${escape_attr(__("Contact Status"))}">
			${escape_html(__(row.status, null, "Supporter"))}
		</span>`;
	}

	render_donor_bookings_row(row) {
		return `
			<tr class="donor-bookings-row" data-donor-name="${escape_attr(row.name)}">
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
			return `<div class="donor-bookings-loading">${escape_html(__("Loading..."))}</div>`;
		}

		if (state.error) {
			return `<div class="donor-bookings-empty">${escape_html(state.error)}</div>`;
		}

		if (!state.rows.length) {
			return `<div class="donor-bookings-empty">${escape_html(
				__("No donation bookings found.")
			)}</div>`;
		}

		const rows = state.rows.map((booking) => this.render_booking_row(booking)).join("");
		const loadMore = state.hasMore
			? `<div class="mt-2">
				<button type="button" class="btn btn-xs btn-secondary donor-bookings-load-more" data-donor-name="${escape_attr(
					donorName
				)}">
					${get_icon("chevrons-down")}${__("Load More Bookings")}
				</button>
			</div>`
			: "";

		return `
			<div class="table-responsive">
				<table class="table table-bordered booking-table">
					<thead>
						<tr>
							<th class="date-cell">${escape_html(__("Date"))}</th>
							<th class="amount-cell">${escape_html(__("Donation Amount"))}</th>
							<th>${escape_html(__("Account"))}</th>
							<th>${escape_html(__("Remarks"))}</th>
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
				<td class="amount-cell">${format_money(booking.amount)}</td>
				<td>${escape_html(booking.account_name || booking.account)}</td>
				<td class="booking-remarks-cell" title="${escape_attr(booking.remarks || "")}">${escape_html(
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
					cost_center: this.filters.costCenterControl.get_value(),
					from_date: this.filters.fromDateControl.get_value(),
					to_date: this.filters.toDateControl.get_value(),
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
				<span>${escape_html(donor.full_name || donor.name)}</span>
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
			.map((value) => escape_html(value))
			.join("<br>");
		const rows = [
			[__("Email Address"), donor.email_address],
			[__("Phone"), donor.phone],
			[__("Address"), address],
		]
			.map(
				([label, value]) => `
				<div class="label">${escape_html(label)}</div>
				<div>${label === __("Address") ? value || "" : escape_html(value || "")}</div>
			`
			)
			.join("");
		const statusDetails = donor.contact_status_details?.trim();
		const statusDetailsHtml = statusDetails
			? `<div class="donor-status-details mb-4">
				<div class="text-muted mb-2">${escape_html(__("Status Details"))}</div>
				<div style="white-space: pre-wrap; overflow-wrap: anywhere;">${escape_html(statusDetails)}</div>
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
				cost_center: this.filters.costCenterControl.get_value(),
				from_date: this.filters.fromDateControl.get_value(),
				to_date: this.filters.toDateControl.get_value(),
				changes,
			},
			freeze: true,
		});
		dialog.hide();
		frappe.show_alert({ message: __("Contact change request created."), indicator: "green" });
	}

	invalidate_requests() {
		++this.donorRequestGeneration;
		this.expandedDonors.clear();
		this.donorBookings = {};
		this.loadMore?.$button.prop("disabled", true);
	}

	format_datetime(value) {
		if (!value) {
			return "";
		}
		return frappe.datetime.str_to_user(String(value).replace("T", " ").slice(0, 19));
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
}
