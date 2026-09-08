export function escape_html(value) {
	return frappe.utils.escape_html(value == null ? "" : String(value));
}

export function escape_attr(value) {
	return escape_html(value).replace(/"/g, "&quot;");
}

export function format_money(value) {
	return format_currency(flt(value || 0));
}

export function get_icon(icon) {
	return frappe.utils.icon(icon, "sm");
}

// Values are formatted markup supplied by the page, labels are always escaped.
export function render_kpis(parent, items) {
	parent.html(
		items
			.map(
				([label, value]) => `
		<div class="kpi">
			<div class="kpi-label">${escape_html(label)}</div>
			<div class="kpi-value">${value}</div>
		</div>
	`
			)
			.join("")
	);
}

export class LoadMore {
	constructor(parent, on_load) {
		this.$row = $('<div class="load-more-row">').hide().appendTo(parent);
		this.$button = $('<button class="btn btn-secondary" type="button">')
			.on("click.donationLoadMore", () => on_load())
			.appendTo(this.$row);
		this.set_loading(false);
	}

	set_loading(loading) {
		this.$button
			.prop("disabled", loading)
			.html(
				loading
					? `${get_icon("loader-circle")}${__("Loading...")}`
					: `${get_icon("chevrons-down")}${__("Load More")}`
			);
	}

	destroy() {
		this.$button.off(".donationLoadMore");
		this.$row.remove();
	}
}
