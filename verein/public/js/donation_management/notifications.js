import { escape_html, escape_attr, get_icon } from "./presentation.js";

const API = "verein.donation_management.notifications.";

export function valid_notification_rules(rules) {
	return rules.every(
		(rule) =>
			!rule.notify_large_donation ||
			(Number.isFinite(Number(rule.threshold)) && Number(rule.threshold) > 0)
	);
}

export class DonationNotificationsPage {
	constructor(wrapper) {
		this.rules = [];
		this.costCenters = [];
		this.version = 0;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: __("Notifications"),
			single_column: true,
		});
		this.$root = $('<div class="donation-management donation-notifications m-3">').appendTo(
			this.page.main
		);
		this.$save = this.page.set_primary_action(__("Save"), () => this.save());
		this.$root.on("click", ".add-notification", () => this.add());
		this.$root.on("click", "[data-remove]", (event) => {
			this.rules.splice(Number(event.currentTarget.dataset.remove), 1);
			this.set_dirty();
			this.render();
		});
		this.$root.on("input change", "[data-field]", (event) => {
			const input = event.currentTarget;
			const rule = this.rules[Number(input.dataset.rule)];
			rule[input.dataset.field] =
				input.type === "checkbox" ? Number(input.checked) : input.value;
			if (input.dataset.field === "notify_large_donation") {
				$(input)
					.closest(".notification-card")
					.find(".notification-threshold")
					.prop("hidden", !rule.notify_large_donation)
					.find("input")
					.prop("required", Boolean(rule.notify_large_donation));
			}
			this.set_dirty();
		});
		this.$save.prop("disabled", true);
	}

	async refresh() {
		// Desk refresh events must not overwrite edits that have not been saved.
		if (this.dirty || this.saving) return;
		const version = ++this.version;
		const response = await frappe.call({ method: API + "get_notification_settings" });
		if (this.destroyed || version !== this.version || this.dirty) return;
		this.apply_settings(response.message);
	}

	apply_settings(settings) {
		this.costCenters = settings.cost_centers;
		this.rules = settings.rules;
		this.email = settings.email;
		this.timezone = settings.timezone;
		this.dirty = false;
		this.$save.prop("disabled", true);
		this.page.clear_indicator();
		this.render();
	}

	set_dirty() {
		this.dirty = true;
		this.$save.prop("disabled", false);
		this.page.set_indicator(__("Not Saved"), "orange");
	}

	render() {
		this.$root.html(`
			<fieldset class="notification-fields">
				<div class="notification-toolbar">
				<div class="notification-picker filter-row">
					<div class="notification-company"></div>
					<div class="notification-cost-center"></div>
					<button type="button" class="btn btn-default add-notification" disabled>
						<span aria-hidden="true">${get_icon("plus")}</span>${escape_html(__("Add Cost Center"))}
					</button>
				</div>
				<div class="notification-recipient" title="${escape_attr(
					__("Recipient: {0}", [this.email || ""])
				)}">
					<span aria-hidden="true">${get_icon("mail")}</span>
					<span class="notification-recipient-label">${escape_html(__("Recipient"))}</span>
					<span class="notification-recipient-address">${escape_html(this.email || "")}</span>
				</div>
				</div>
				${
					this.rules.length
						? `<div class="notification-cards">${this.rules
								.map((rule, index) => this.render_card(rule, index))
								.join("")}</div>`
						: `<div class="notification-empty">
						<span class="notification-empty-icon" aria-hidden="true">${get_icon("bell")}</span>
						<p>${escape_html(
							this.costCenters.length
								? __(
										"No notifications configured. Add a cost center to get started."
								  )
								: __("No cost centers have been shared with you yet.")
						)}</p>
					</div>`
				}
			</fieldset>
		`);
		this.render_picker();
	}

	render_card(rule, index) {
		const center = this.costCenters.find((row) => row.name === rule.cost_center);
		const checkbox = (field, label) => `
			<label class="notification-toggle">
				<input type="checkbox" data-rule="${index}" data-field="${field}" ${rule[field] ? "checked" : ""}>
				<span>${escape_html(label)}</span>
			</label>`;
		return `<section class="notification-card">
			<div class="notification-card-heading">
				<div><h3>${escape_html(center.display_name || center.name)}</h3>
					<p class="text-muted">${escape_html(center.company)}</p></div>
				<button type="button" class="btn btn-link btn-sm notification-remove" data-remove="${index}">${escape_html(
			__("Remove")
		)}</button>
			</div>
			${checkbox("notify_new_donor", __("Notify me about new donors"))}
			${checkbox("notify_large_donation", __("Notify me about donations at or above a threshold"))}
			<div class="notification-threshold" ${rule.notify_large_donation ? "" : "hidden"}>
				<label for="notification-threshold-${index}">${escape_html(
			__("Threshold ({0})", [center.currency])
		)}</label>
				<input id="notification-threshold-${index}" type="number" step="any" min="0" class="form-control"
					data-rule="${index}" data-field="threshold" value="${escape_attr(rule.threshold || "")}" ${
			rule.notify_large_donation ? "required" : ""
		}>
			</div>
		</section>`;
	}

	render_picker() {
		const companies = [...new Set(this.costCenters.map((row) => row.company))];
		if (!companies.includes(this.selectedCompany)) this.selectedCompany = companies[0] || "";
		this.companyControl = frappe.ui.form.make_control({
			parent: this.$root.find(".notification-company"),
			render_input: true,
			df: {
				fieldname: "company",
				label: __("Company"),
				fieldtype: "Select",
				options: companies.map((company) => ({
					label: escape_html(company),
					value: company,
				})),
				change: () => {
					this.selectedCompany = this.companyControl.get_value();
					this.update_cost_center_options();
				},
			},
		});
		this.companyControl.set_input(this.selectedCompany);
		this.$root.find(".notification-company").toggle(companies.length > 1);
		this.$root
			.find(".notification-picker")
			.toggleClass("company-filter-hidden", companies.length <= 1);
		this.costCenterControl = frappe.ui.form.make_control({
			parent: this.$root.find(".notification-cost-center"),
			render_input: true,
			df: {
				fieldname: "cost_center",
				label: __("Cost Center"),
				fieldtype: "Select",
				options: [],
				change: () => {
					this.selectedCostCenter = this.costCenterControl.get_value();
				},
			},
		});
		this.update_cost_center_options();
	}

	update_cost_center_options() {
		const choices = this.costCenters.filter(
			(center) =>
				center.company === this.selectedCompany &&
				!this.rules.some((rule) => rule.cost_center === center.name)
		);
		if (!choices.some((row) => row.name === this.selectedCostCenter)) {
			this.selectedCostCenter = choices[0]?.name || "";
		}
		this.costCenterControl.df.options = choices.map((row) => ({
			label: escape_html(row.display_name || row.cost_center_name || row.name),
			value: row.name,
		}));
		this.costCenterControl.refresh();
		this.costCenterControl.set_input(this.selectedCostCenter);
		this.costCenterControl.$input.prop("disabled", !choices.length);
		this.$root
			.find(".add-notification")
			.prop("disabled", !choices.length || Boolean(this.saving));
	}

	add() {
		const cost_center = this.costCenterControl.get_value();
		if (
			this.destroyed ||
			this.saving ||
			!this.costCenters.some(
				(row) => row.name === cost_center && row.company === this.selectedCompany
			) ||
			this.rules.some((rule) => rule.cost_center === cost_center)
		)
			return;
		this.rules.push({
			cost_center,
			notify_new_donor: 0,
			notify_large_donation: 0,
			threshold: 0,
		});
		this.set_dirty();
		this.render();
	}

	async save() {
		if (this.saving || !this.dirty) return;
		if (!valid_notification_rules(this.rules)) {
			frappe.msgprint(__("Enter a positive threshold for large donations."));
			return;
		}
		this.saving = true;
		++this.version;
		this.$save.prop("disabled", true);
		this.$root.find("fieldset").prop("disabled", true);
		try {
			const response = await frappe.call({
				method: API + "save_notification_settings",
				args: { settings: { rules: this.rules } },
			});
			if (this.destroyed) return;
			this.apply_settings(response.message);
			frappe.show_alert({ message: __("Notification settings saved."), indicator: "green" });
		} catch {
			// frappe.call presents server errors. Preserve edits for another attempt.
		} finally {
			this.saving = false;
			if (!this.destroyed) {
				this.$save.prop("disabled", !this.dirty);
				this.$root.find("fieldset").prop("disabled", false);
				this.update_cost_center_options();
			}
		}
	}

	destroy() {
		this.destroyed = true;
		++this.version;
		this.$root.off().remove();
	}
}
