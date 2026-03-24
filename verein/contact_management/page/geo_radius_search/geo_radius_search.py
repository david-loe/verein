from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt
from frappe.utils.xlsxutils import build_xlsx_response

from verein.contact_management.utils import calculate_distance_km, get_bounding_box

SEARCH_CONFIG = {
	"Supporter": {
		"export_columns": [
			("name", _("ID")),
			("title", _("Name")),
			("distance_km", _("Distance (km)")),
			("email_address", _("Email")),
			("phone", _("Phone")),
			("city", _("City")),
			("postal_code", _("Postal Code")),
			("matched_networks_display", _("Matched Networks")),
			("matched_experiences_display", _("Matched Experiences")),
			("matched_tags_display", _("Matched Tags")),
		],
		"fields": [
			"name",
			"full_name",
			"email_address",
			"phone",
			"city",
			"postal_code",
			"latitude",
			"longitude",
		],
		"secondary_fields": ("email_address", "phone", "city"),
		"title_field": "full_name",
	},
	"Network": {
		"export_columns": [
			("name", _("ID")),
			("title", _("Name")),
			("distance_km", _("Distance (km)")),
			("type", _("Type")),
			("city", _("City")),
			("postal_code", _("Postal Code")),
		],
		"fields": ["name", "network_name", "type", "city", "postal_code", "latitude", "longitude"],
		"secondary_fields": ("type", "city"),
		"title_field": "network_name",
	},
}

SUPPORTER_RELATIONS = {
	"experiences": ("Supporter Experience", "experience"),
	"networks": ("Supporter Network", "network"),
}


@frappe.whitelist()
def search_records(
	search_doctype: str,
	latitude: float,
	longitude: float,
	radius_km: int,
	filters: list[Any] | str | None = None,
	networks: list[str] | str | None = None,
	experiences: list[str] | str | None = None,
	tags: list[str] | str | None = None,
	network_type: str | None = None,
) -> list[dict[str, Any]]:
	return get_search_results(
		search_doctype=search_doctype,
		latitude=latitude,
		longitude=longitude,
		radius_km=radius_km,
		filters=filters,
		networks=networks,
		experiences=experiences,
		tags=tags,
		network_type=network_type,
	)


@frappe.whitelist()
def export_records(
	search_doctype: str,
	latitude: float,
	longitude: float,
	radius_km: int,
	filters: list[Any] | str | None = None,
	networks: list[str] | str | None = None,
	experiences: list[str] | str | None = None,
	tags: list[str] | str | None = None,
	network_type: str | None = None,
) -> None:
	results = get_search_results(
		search_doctype=search_doctype,
		latitude=latitude,
		longitude=longitude,
		radius_km=radius_km,
		filters=filters,
		networks=networks,
		experiences=experiences,
		tags=tags,
		network_type=network_type,
	)

	config = SEARCH_CONFIG[search_doctype]
	rows = [[label for _, label in config["export_columns"]]]
	for result in results:
		rows.append([result.get(field) for field, _ in config["export_columns"]])

	build_xlsx_response(rows, f"Geo Radius Search {search_doctype}")


def get_search_results(
	search_doctype: str,
	latitude: float,
	longitude: float,
	radius_km: int,
	filters: list[Any] | str | None = None,
	networks: list[str] | str | None = None,
	experiences: list[str] | str | None = None,
	tags: list[str] | str | None = None,
	network_type: str | None = None,
) -> list[dict[str, Any]]:
	config = SEARCH_CONFIG.get(search_doctype)
	if not config:
		frappe.throw(_("Unsupported search doctype: {0}").format(search_doctype))

	origin_latitude = flt(latitude)
	origin_longitude = flt(longitude)
	max_distance_km = cint(radius_km)
	if max_distance_km <= 0:
		frappe.throw(_("Radius must be greater than zero."))
	min_latitude, max_latitude, min_longitude, max_longitude = get_bounding_box(
		origin_latitude,
		origin_longitude,
		max_distance_km,
	)

	selected_networks = normalize_names(networks)
	selected_experiences = normalize_names(experiences)
	selected_tags = normalize_names(tags)
	normalized_filters = normalize_filters(filters, search_doctype)
	selected_network_type = cstr(network_type).strip()
	normalized_filters.extend(
		[
			[search_doctype, "latitude", ">=", min_latitude],
			[search_doctype, "latitude", "<=", max_latitude],
			[search_doctype, "longitude", ">=", min_longitude],
			[search_doctype, "longitude", "<=", max_longitude],
		]
	)

	if search_doctype == "Supporter":
		if selected_tags and not frappe.db.has_column(search_doctype, "_user_tags"):
			return []

		supporter_name_filter = get_supporter_name_filter(
			networks=selected_networks,
			experiences=selected_experiences,
		)
		if supporter_name_filter == []:
			return []
		if supporter_name_filter is not None:
			normalized_filters.append([search_doctype, "name", "in", supporter_name_filter])
		for tag in selected_tags:
			normalized_filters.append([search_doctype, "_user_tags", "like", f"%{tag}%"])
	elif search_doctype == "Network" and selected_network_type:
		normalized_filters.append([search_doctype, "type", "=", selected_network_type])

	records = frappe.get_all(
		search_doctype,
		fields=config["fields"],
		filters=normalized_filters,
		limit_page_length=0,
		order_by="modified desc",
	)

	match_contexts = {}
	if search_doctype == "Supporter":
		match_contexts = get_supporter_match_context(
			supporter_names=[record.name for record in records],
			networks=selected_networks,
			experiences=selected_experiences,
			tags=selected_tags,
		)

	results = []
	for record in records:
		record_latitude = record.get("latitude")
		record_longitude = record.get("longitude")
		if record_latitude is None or record_longitude is None:
			continue

		record_latitude = flt(record_latitude)
		record_longitude = flt(record_longitude)
		distance_km = calculate_distance_km(
			origin_latitude,
			origin_longitude,
			record_latitude,
			record_longitude,
		)
		if distance_km > max_distance_km:
			continue

		title = record.get(config["title_field"]) or record.name
		match_context = match_contexts.get(record.name, {})
		results.append(
			{
				"city": record.get("city"),
				"distance_km": round(distance_km, 2),
				"email_address": record.get("email_address"),
				"latitude": record_latitude,
				"longitude": record_longitude,
				"matched_experiences": match_context.get("experiences", []),
				"matched_experiences_display": ", ".join(match_context.get("experiences", [])),
				"matched_networks": match_context.get("networks", []),
				"matched_networks_display": ", ".join(match_context.get("networks", [])),
				"matched_tags": match_context.get("tags", []),
				"matched_tags_display": ", ".join(match_context.get("tags", [])),
				"name": record.name,
				"phone": record.get("phone"),
				"postal_code": record.get("postal_code"),
				"secondary_values": [
					record.get(field) for field in config["secondary_fields"] if record.get(field)
				],
				"title": title,
				"type": record.get("type"),
			}
		)

	results.sort(key=lambda row: (row["distance_km"], cstr(row["title"] or row["name"])))
	return results


def get_supporter_name_filter(
	networks: list[str] | None = None,
	experiences: list[str] | None = None,
) -> list[str] | None:
	selected_supporters: set[str] | None = None
	for filter_name, names in (("networks", networks or []), ("experiences", experiences or [])):
		if not names:
			continue

		child_doctype, link_field = SUPPORTER_RELATIONS[filter_name]
		matching_supporters = {
			row.parent
			for row in frappe.get_all(
				child_doctype,
				fields=["parent"],
				filters={link_field: ["in", names]},
				limit_page_length=0,
			)
		}
		selected_supporters = (
			matching_supporters
			if selected_supporters is None
			else selected_supporters & matching_supporters
		)
		if not selected_supporters:
			return []

	return sorted(selected_supporters) if selected_supporters is not None else None


def get_supporter_match_context(
	supporter_names: list[str],
	networks: list[str] | None = None,
	experiences: list[str] | None = None,
	tags: list[str] | None = None,
) -> dict[str, dict[str, list[str]]]:
	context = {name: {"networks": [], "experiences": [], "tags": []} for name in supporter_names}
	if not supporter_names:
		return context

	if networks:
		for row in frappe.get_all(
			"Supporter Network",
			fields=["parent", "network"],
			filters={
				"parent": ["in", supporter_names],
				"network": ["in", networks],
			},
			limit_page_length=0,
		):
			context.setdefault(row.parent, {"networks": [], "experiences": [], "tags": []})
			context[row.parent]["networks"].append(row.network)

	if experiences:
		for row in frappe.get_all(
			"Supporter Experience",
			fields=["parent", "experience"],
			filters={
				"parent": ["in", supporter_names],
				"experience": ["in", experiences],
			},
			limit_page_length=0,
		):
			context.setdefault(row.parent, {"networks": [], "experiences": [], "tags": []})
			context[row.parent]["experiences"].append(row.experience)

	if tags and frappe.db.has_column("Supporter", "_user_tags"):
		selected_tags = set(tags)
		for row in frappe.get_all(
			"Supporter",
			fields=["name", "_user_tags"],
			filters={"name": ["in", supporter_names]},
			limit_page_length=0,
		):
			context.setdefault(row.name, {"networks": [], "experiences": [], "tags": []})
			row_tags = [cstr(tag).strip() for tag in cstr(row.get("_user_tags")).split(",") if cstr(tag).strip()]
			context[row.name]["tags"].extend(tag for tag in row_tags if tag in selected_tags)

	for values in context.values():
		values["networks"] = sorted(dict.fromkeys(values["networks"]))
		values["experiences"] = sorted(dict.fromkeys(values["experiences"]))
		values["tags"] = sorted(dict.fromkeys(values["tags"]))

	return context


def normalize_names(values: list[str] | str | None) -> list[str]:
	if isinstance(values, str):
		values = frappe.parse_json(values)

	return [cstr(value).strip() for value in dict.fromkeys(values or []) if cstr(value).strip()]


def normalize_filters(filters: list[Any] | str | None, search_doctype: str) -> list[list[Any]]:
	if isinstance(filters, str):
		filters = frappe.parse_json(filters)

	normalized = []
	for raw_filter in filters or []:
		if isinstance(raw_filter, dict):
			fieldname = raw_filter.get("fieldname") or raw_filter.get("field")
			operator = raw_filter.get("operator") or raw_filter.get("condition") or "="
			value = raw_filter.get("value")
			if fieldname:
				normalized.append([search_doctype, fieldname, operator, value])
			continue

		if not isinstance(raw_filter, (list, tuple)):
			continue

		filter_values = list(raw_filter)
		if len(filter_values) == 3:
			normalized.append([search_doctype, *filter_values])
			continue

		if len(filter_values) >= 4:
			if filter_values[0] != search_doctype:
				filter_values = [search_doctype, *filter_values[-3:]]
			normalized.append(filter_values[:4])

	return normalized
