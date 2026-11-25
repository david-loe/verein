const review_api =
	"verein.donation_management.doctype.supporter_contact_change_request.supporter_contact_change_request";

frappe.ui.form.on("Supporter Contact Change Request", {
	refresh(frm) {
		render_supporter_display(frm);

		if (frm.doc.__islocal || frm.doc.status !== "Pending") {
			return;
		}

		if (
			!frappe.user.has_role("Supporter Change Reviewer") &&
			!frappe.user.has_role("System Manager")
		) {
			return;
		}

		frm.add_custom_button(
			__("Approve"),
			() => review_request(frm, "approve_request"),
			__("Review")
		);
		frm.add_custom_button(
			__("Reject"),
			() => review_request(frm, "reject_request"),
			__("Review")
		);
		frm.add_custom_button(__("Next"), () => open_next_pending_request(frm), __("Review"));
	},
});

function render_supporter_display(frm) {
	const $wrapper = frm.fields_dict.supporter_display?.$wrapper;
	if (!$wrapper) return;
	$wrapper.empty();

	const display = frm.doc.__onload?.supporter_display;
	if (!display) return;

	$("<label>", { class: "control-label" })
		.text(__(display.label, null, "Supporter"))
		.appendTo($wrapper);
	const value = display.value;
	$("<div>", { class: "like-disabled-input text-break" })
		.text(value == null || value === "" ? "—" : frappe.utils.unescape_html(value))
		.appendTo($wrapper);
}

function open_next_pending_request(frm) {
	return frappe.call({
		method: `${review_api}.get_next_pending_request`,
		type: "GET",
		args: { name: frm.doc.name },
		freeze: true,
		callback: ({ message }) => open_review_route(frm.doctype, message),
	});
}

function open_review_route(doctype, name) {
	return name ? frappe.set_route("Form", doctype, name) : frappe.set_route("List", doctype);
}

function review_request(frm, method) {
	const approving = method === "approve_request";
	const title = approving ? __("Approve Request") : __("Reject Request");
	let submitting = false;
	const dialog = new frappe.ui.Dialog({
		title,
		fields: [
			{
				fieldname: "review_note",
				fieldtype: "Small Text",
				label: __("Review Note"),
			},
		],
		primary_action_label: approving ? __("Approve") : title,
		primary_action: (values) => submit(values),
	});
	if (approving) {
		dialog.set_secondary_action_label(__("Approve and Next"));
		dialog.set_secondary_action(() => submit(dialog.get_values(), true));
	}
	dialog.show();

	function submit(values, continue_review = false) {
		if (!values || submitting) return;

		submitting = true;
		dialog.disable_primary_action();
		dialog.get_secondary_btn().prop("disabled", true);
		const args = { name: frm.doc.name, review_note: values.review_note };
		if (continue_review) args.continue_review = true;

		frappe.call({
			method: `${review_api}.${method}`,
			args,
			freeze: true,
			callback({ message }) {
				if (!message?.status) return;
				dialog.hide();
				if (continue_review) {
					open_review_route(frm.doctype, message.next_request);
				} else {
					frm.reload_doc();
				}
			},
			always() {
				submitting = false;
				dialog.enable_primary_action();
				dialog.get_secondary_btn().prop("disabled", false);
			},
		});
	}
}
