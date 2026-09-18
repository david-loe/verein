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

export function format_date_range(from_date, to_date) {
	if (!from_date || !to_date) return "";
	const [fromYear, fromMonth, fromDay] = from_date.split("-");
	const [toYear, toMonth, toDay] = to_date.split("-");
	const sameYear = fromYear === toYear;
	const hideYear = sameYear && toYear === frappe.datetime.now_date().slice(0, 4);
	const end = `${toDay}.${toMonth}.${hideYear ? "" : toYear}`;
	if (from_date === to_date) return end;
	const start = sameYear
		? fromMonth === toMonth
			? `${fromDay}.`
			: `${fromDay}.${fromMonth}.`
		: `${fromDay}.${fromMonth}.${fromYear}`;
	return `${start}-${end}`;
}

export function dispose_kpi_tooltips(parent) {
	parent.find('[data-toggle="tooltip"]').tooltip("dispose");
}

// Values are formatted markup supplied by the page; all other text is escaped.
export function render_kpis(parent, items) {
	dispose_kpi_tooltips(parent);
	parent.html(
		items
			.map(
				([label, value, subtitle, tooltip]) => `
		<div class="kpi">
			<div class="kpi-label">${escape_html(label)}${
					tooltip
						? `<button type="button" class="info-icon-button" data-toggle="tooltip"
							title="${escape_attr(tooltip)}" aria-label="${escape_attr(tooltip)}">
							${get_icon("info")}</button>`
						: ""
				}</div>
			${subtitle ? `<div class="kpi-subtitle">${escape_html(subtitle)}</div>` : ""}
			<div class="kpi-value">${value}</div>
		</div>
	`
			)
			.join("")
	);
	parent.find('[data-toggle="tooltip"]').tooltip({
		container: parent[0],
		trigger: "hover focus",
		placement: "top",
	});
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
