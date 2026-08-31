frappe.ui.form.on("Cost Center Access", {
	setup(frm) {
		frm.set_query("cost_center", () => ({
			filters: {
				company: frm.doc.company || "",
				disabled: 0,
			},
		}));
	},

	async company(frm) {
		if (!frm.doc.cost_center) {
			return;
		}

		const { message } = await frappe.db.get_value("Cost Center", frm.doc.cost_center, "company");
		if (message?.company !== frm.doc.company) {
			await frm.set_value("cost_center", null);
		}
	},

	async cost_center(frm) {
		if (!frm.doc.cost_center || frm.doc.company) {
			return;
		}

		const { message } = await frappe.db.get_value("Cost Center", frm.doc.cost_center, "company");
		if (message?.company) {
			await frm.set_value("company", message.company);
		}
	},
});
