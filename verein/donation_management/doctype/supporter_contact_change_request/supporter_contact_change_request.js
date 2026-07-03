frappe.ui.form.on("Supporter Contact Change Request", {
	refresh(frm) {
		if (frm.doc.__islocal || frm.doc.status !== "Pending") {
			return;
		}

		if (!frappe.user.has_role("Supporter Change Reviewer") && !frappe.user.has_role("System Manager")) {
			return;
		}

		frm.add_custom_button(__("Approve"), () => review_request(frm, "approve_request"), __("Review"));
		frm.add_custom_button(__("Reject"), () => review_request(frm, "reject_request"), __("Review"));
	},
});

function review_request(frm, method) {
	const title = method === "approve_request" ? __("Approve Request") : __("Reject Request");
	const dialog = new frappe.ui.Dialog({
		title,
		fields: [
			{
				fieldname: "review_note",
				fieldtype: "Small Text",
				label: __("Review Note"),
			},
		],
		primary_action_label: title,
		primary_action(values) {
			dialog.hide();
			frappe.call({
				method: `verein.donation_management.doctype.supporter_contact_change_request.supporter_contact_change_request.${method}`,
				args: {
					name: frm.doc.name,
					review_note: values.review_note,
				},
				freeze: true,
				callback() {
					frm.reload_doc();
				},
			});
		},
	});
	dialog.show();
}
