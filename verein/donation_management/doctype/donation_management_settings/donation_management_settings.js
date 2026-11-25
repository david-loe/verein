frappe.ui.form.on("Donation Management Settings", {
	refresh(frm) {
		const fields = frm.doc.__onload?.review_supporter_display_fields;
		if (!fields) return;

		const options = fields.map(({ fieldname, label }) => ({
			value: fieldname,
			label: frappe.utils.escape_html(`${__(label, null, "Supporter")} (${fieldname})`),
		}));
		options.sort((a, b) => a.label.localeCompare(b.label));
		const current = frm.doc.review_supporter_display_field;
		if (current && !options.some(({ value }) => value === current)) {
			options.unshift({ value: current, label: frappe.utils.escape_html(current) });
		}
		frm.set_df_property("review_supporter_display_field", "options", ["", ...options]);
	},
});
