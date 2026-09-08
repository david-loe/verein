const FILTER_STORAGE_KEY = "verein.donation_management.cost_center_filters";
const DATE_RANGE_PRESETS = {
	CUSTOM: __("Custom"),
	LAST_THREE_MONTHS: __("Last Three Months"),
	LAST_HALF_YEAR: __("Last Half Year"),
	LAST_YEAR: __("Last Year"),
	LAST_THREE_YEARS: __("Last Three Years"),
};

export class DonationFilters {
	constructor({ on_invalidate, on_change }) {
		this.on_invalidate = on_invalidate;
		this.on_change = on_change;
		this.costCenters = [];
		this.version = 0;
		this.restoringFilters = true;
		const fields = [
			["companyControl", "company", __("Company"), "Select", []],
			["costCenterControl", "cost_center", __("Cost Center"), "Select", []],
			[
				"dateRangeControl",
				"period",
				__("Period"),
				"Select",
				Object.values(DATE_RANGE_PRESETS),
			],
			["fromDateControl", "from_date", __("From Date"), "Date"],
			["toDateControl", "to_date", __("To Date"), "Date"],
		];
		this.controls = fields.map(([property, fieldname, label, fieldtype, options]) => {
			this[property] = frappe.ui.form.make_control({
				parent: $("<div>"),
				render_input: true,
				df: { fieldname, label, fieldtype, options, change: () => this.change(fieldname) },
			});
			return this[property];
		});
		this.restoringFilters = false;
	}

	mount(parent) {
		this.$filterRow = $('<div class="filter-row">').appendTo(parent);
		for (const control of this.controls) this.$filterRow.append(control.$wrapper);
	}

	get_values() {
		return {
			company: this.companyControl.get_value() || null,
			cost_center: this.costCenterControl.get_value() || null,
			period: this.dateRangeControl.get_value() || null,
			from_date: this.fromDateControl.get_value() || null,
			to_date: this.toDateControl.get_value() || null,
		};
	}

	async refresh() {
		this.cancel_pending();
		const version = ++this.version;
		const response = await frappe.call({
			method: "verein.donation_management.cost_center_dashboard.get_accessible_cost_centers",
		});
		if (this.destroyed || version !== this.version) return null;
		this.costCenters = response.message || [];
		this.configure_company_filter();
		await this.restore_filters();
		return this.costCenters.length > 0;
	}

	async change(field) {
		if (this.restoringFilters || this.destroyed) return;
		this.cancel_pending();
		const version = ++this.version;
		this.on_invalidate();
		const changed = [field];
		this.restoringFilters = true;
		try {
			if (field === "company") {
				const options = this.set_cost_center_options(this.companyControl.get_value());
				const current = this.costCenterControl.get_value();
				await this.costCenterControl.set_value(
					options.some((option) => option.value === current)
						? current
						: options[0]?.value || ""
				);
				changed.push("cost_center");
			} else if (field === "period") {
				const dates = this.get_dates_for_date_range(this.dateRangeControl.get_value());
				if (dates) {
					await Promise.all([
						this.fromDateControl.set_value(dates.from_date),
						this.toDateControl.set_value(dates.to_date),
					]);
					changed.push("from_date", "to_date");
				}
			} else if (["from_date", "to_date"].includes(field)) {
				if (!this.current_dates_match_selected_preset()) {
					await this.dateRangeControl.set_value(DATE_RANGE_PRESETS.CUSTOM);
					changed.push("period");
				}
			}
		} finally {
			this.restoringFilters = false;
		}
		if (this.destroyed || version !== this.version) return;
		this.store_filters();
		if (["from_date", "to_date"].includes(field)) {
			this.timer = setTimeout(() => this.notify(changed), 300);
		} else {
			await this.notify(changed);
		}
	}

	async notify(changed) {
		this.cancel_pending();
		if (this.destroyed) return;
		try {
			await this.on_change(this.get_values(), changed);
		} catch (error) {
			frappe.msgprint(error.message || __("Data could not be loaded."));
		}
	}

	cancel_pending() {
		clearTimeout(this.timer);
		this.timer = null;
	}

	destroy() {
		this.destroyed = true;
		++this.version;
		this.cancel_pending();
		this.$filterRow?.remove();
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
		return (
			this.fromDateControl.get_value() === fromDate &&
			this.toDateControl.get_value() === toDate
		);
	}

	get_month_start(date) {
		return moment(date).startOf("month").format("YYYY-MM-DD");
	}

	get_stored_filters() {
		try {
			const filters = JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY) || "null");
			return filters && typeof filters === "object" ? filters : null;
		} catch {
			return null;
		}
	}

	store_filters() {
		try {
			sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(this.get_values()));
		} catch {
			// Ignore storage failures; filters should still work for the current page.
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

	get_valid_stored_period(storedFilters) {
		const storedPeriod = storedFilters?.period;
		return Object.values(DATE_RANGE_PRESETS).includes(storedPeriod) ? storedPeriod : null;
	}

	has_stored_dates(storedFilters) {
		return Boolean(storedFilters?.from_date && storedFilters?.to_date);
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
				: this.companies[0] || "");
		const options = this.set_cost_center_options(company);
		const costCenter =
			storedCostCenter?.company === company
				? storedCostCenter.name
				: options[0]?.value || "";
		const hasStoredDates = this.has_stored_dates(storedFilters);
		let period =
			this.get_valid_stored_period(storedFilters) || DATE_RANGE_PRESETS.LAST_HALF_YEAR;
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
			await this.companyControl.set_value(company);
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
}
