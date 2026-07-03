from __future__ import annotations

from datetime import date
from typing import Any

import frappe
from frappe import _
from frappe.utils import cint, flt

from verein.donation_management.cost_center_dashboard import normalize_period
from verein.donation_management.doctype.supporter_contact_change_request.supporter_contact_change_request import (
	ALLOWED_CHANGE_FIELDS,
	make_change_request,
)
from verein.donation_management.permissions import get_descendant_cost_centers, has_cost_center_access

DEFAULT_PAGE_LENGTH = 100
MAX_PAGE_LENGTH = 500
DEFAULT_BOOKING_PAGE_LENGTH = 100


@frappe.whitelist()
def get_donors(
	cost_center: str,
	from_date: str | date | None = None,
	to_date: str | date | None = None,
	search: str | None = None,
	limit_start: int | str = 0,
	limit: int | str = DEFAULT_PAGE_LENGTH,
	order_by: str | None = "amount",
	order_direction: str | None = "desc",
) -> dict[str, Any]:
	if not has_cost_center_access(cost_center):
		frappe.throw(_("You are not allowed to access this cost center."))

	from_date, to_date = normalize_period(from_date, to_date)
	cost_centers = get_descendant_cost_centers(cost_center)
	if not cost_centers:
		frappe.throw(_("Cost Center {0} was not found.").format(cost_center))

	limit_start = max(cint(limit_start), 0)
	limit = min(max(cint(limit or DEFAULT_PAGE_LENGTH), 1), MAX_PAGE_LENGTH)
	order_clause = get_order_clause(order_by, order_direction)
	rows = get_donor_rows(cost_centers, from_date, to_date, search, limit_start, limit + 1, order_clause)
	has_more = len(rows) > limit
	rows = rows[:limit]
	summary = get_donor_summary(cost_centers, from_date, to_date, search)

	return {
		"cost_center": cost_center,
		"from_date": from_date.isoformat(),
		"to_date": to_date.isoformat(),
		"limit_start": limit_start,
		"limit": limit,
		"has_more": has_more,
		"next_limit_start": limit_start + len(rows),
		"summary": summary,
		"donors": rows,
	}


def get_donor_rows(
	cost_centers: list[str],
	from_date: date,
	to_date: date,
	search: str | None,
	limit_start: int,
	limit: int,
	order_clause: str,
) -> list[dict[str, Any]]:
	conditions, values = get_donor_conditions(cost_centers, from_date, to_date, search)
	rows = frappe.db.sql(
		f"""
		select
			`tabSupporter`.`name`,
			`tabSupporter`.`full_name`,
			`tabSupporter`.`first_name`,
			`tabSupporter`.`last_name`,
			`tabSupporter`.`email_address`,
			`tabSupporter`.`phone`,
			`tabSupporter`.`address_line_1`,
			`tabSupporter`.`address_line_2`,
			`tabSupporter`.`postal_code`,
			`tabSupporter`.`city`,
			`tabSupporter`.`country`,
			`tabSupporter`.`contact_or_address_modified`,
			sum(`tabGL Entry`.`credit` - `tabGL Entry`.`debit`) as amount,
			count(`tabGL Entry`.`name`) as booking_count,
			max(`tabGL Entry`.`posting_date`) as last_donation_date
		from `tabGL Entry`
		inner join `tabAccount` on `tabAccount`.`name` = `tabGL Entry`.`account`
		inner join `tabSupporter` on `tabSupporter`.`name` = `tabGL Entry`.`supporter`
		where {conditions}
		group by
			`tabSupporter`.`name`,
			`tabSupporter`.`full_name`,
			`tabSupporter`.`first_name`,
			`tabSupporter`.`last_name`,
			`tabSupporter`.`email_address`,
			`tabSupporter`.`phone`,
			`tabSupporter`.`address_line_1`,
			`tabSupporter`.`address_line_2`,
			`tabSupporter`.`postal_code`,
			`tabSupporter`.`city`,
			`tabSupporter`.`country`,
			`tabSupporter`.`contact_or_address_modified`
		having amount > 0
		order by {order_clause}
		limit %(limit)s offset %(limit_start)s
		""",
		{**values, "limit": limit, "limit_start": limit_start},
		as_dict=True,
	)
	for row in rows:
		row["amount"] = flt(row.amount)
		row["booking_count"] = cint(row.booking_count)
	return rows


def get_donor_summary(
	cost_centers: list[str],
	from_date: date,
	to_date: date,
	search: str | None,
) -> dict[str, Any]:
	conditions, values = get_donor_conditions(cost_centers, from_date, to_date, search)
	row = frappe.db.sql(
		f"""
		select count(*) as donor_count, sum(amount) as amount
		from (
			select sum(`tabGL Entry`.`credit` - `tabGL Entry`.`debit`) as amount
			from `tabGL Entry`
			inner join `tabAccount` on `tabAccount`.`name` = `tabGL Entry`.`account`
			inner join `tabSupporter` on `tabSupporter`.`name` = `tabGL Entry`.`supporter`
			where {conditions}
			group by `tabGL Entry`.`supporter`
			having amount > 0
		) donor_totals
		""",
		values,
		as_dict=True,
	)[0]
	return {"donor_count": cint(row.donor_count), "amount": flt(row.amount)}


def get_donor_conditions(
	cost_centers: list[str],
	from_date: date,
	to_date: date,
	search: str | None,
) -> tuple[str, dict[str, Any]]:
	conditions = [
		"`tabGL Entry`.`is_cancelled` = 0",
		"`tabGL Entry`.`cost_center` in %(cost_centers)s",
		"`tabGL Entry`.`posting_date` between %(from_date)s and %(to_date)s",
		"`tabGL Entry`.`supporter` is not null",
		"`tabGL Entry`.`supporter` != ''",
		"`tabAccount`.`root_type` = 'Income'",
	]
	values: dict[str, Any] = {
		"cost_centers": tuple(cost_centers),
		"from_date": from_date,
		"to_date": to_date,
	}
	if search:
		conditions.append(
			"""(
				`tabSupporter`.`name` like %(search)s
				or `tabSupporter`.`full_name` like %(search)s
				or `tabSupporter`.`email_address` like %(search)s
				or `tabSupporter`.`city` like %(search)s
			)"""
		)
		values["search"] = f"%{search.strip()}%"
	return " and ".join(conditions), values


def get_order_clause(order_by: str | None, order_direction: str | None) -> str:
	order_columns = {
		"full_name": "coalesce(`tabSupporter`.`full_name`, `tabSupporter`.`name`)",
		"amount": "amount",
		"last_donation_date": "last_donation_date",
		"booking_count": "booking_count",
		"contact_or_address_modified": "`tabSupporter`.`contact_or_address_modified`",
	}
	if order_by not in order_columns:
		order_by = "amount"
		order_direction = "desc"
	direction = "asc" if (order_direction or "").lower() == "asc" else "desc"
	return f"{order_columns[order_by]} {direction}, coalesce(`tabSupporter`.`full_name`, `tabSupporter`.`name`) asc"


@frappe.whitelist()
def get_donor_bookings(
	supporter: str,
	cost_center: str,
	from_date: str | date | None = None,
	to_date: str | date | None = None,
	limit_start: int | str = 0,
	limit: int | str = DEFAULT_BOOKING_PAGE_LENGTH,
) -> dict[str, Any]:
	if not has_cost_center_access(cost_center):
		frappe.throw(_("You are not allowed to access this cost center."))

	from_date, to_date = normalize_period(from_date, to_date)
	cost_centers = get_descendant_cost_centers(cost_center)
	if not cost_centers:
		frappe.throw(_("Cost Center {0} was not found.").format(cost_center))

	limit_start = max(cint(limit_start), 0)
	limit = min(max(cint(limit or DEFAULT_BOOKING_PAGE_LENGTH), 1), MAX_PAGE_LENGTH)
	rows = get_donor_booking_rows(supporter, cost_centers, from_date, to_date, limit_start, limit + 1)
	has_more = len(rows) > limit
	rows = rows[:limit]

	return {
		"supporter": supporter,
		"cost_center": cost_center,
		"from_date": from_date.isoformat(),
		"to_date": to_date.isoformat(),
		"limit_start": limit_start,
		"limit": limit,
		"has_more": has_more,
		"next_limit_start": limit_start + len(rows),
		"bookings": rows,
	}


def get_donor_booking_rows(
	supporter: str,
	cost_centers: list[str],
	from_date: date,
	to_date: date,
	limit_start: int,
	limit: int,
) -> list[dict[str, Any]]:
	rows = frappe.db.sql(
		"""
		select
			`tabGL Entry`.`name`,
			`tabGL Entry`.`posting_date`,
			`tabGL Entry`.`cost_center`,
			`tabCost Center`.`cost_center_name`,
			`tabGL Entry`.`account`,
			`tabAccount`.`account_name`,
			`tabGL Entry`.`voucher_type`,
			`tabGL Entry`.`voucher_no`,
			`tabGL Entry`.`remarks`,
			`tabGL Entry`.`credit` - `tabGL Entry`.`debit` as amount
		from `tabGL Entry`
		inner join `tabAccount` on `tabAccount`.`name` = `tabGL Entry`.`account`
		left join `tabCost Center` on `tabCost Center`.`name` = `tabGL Entry`.`cost_center`
		where
			`tabGL Entry`.`is_cancelled` = 0
			and `tabGL Entry`.`supporter` = %(supporter)s
			and `tabGL Entry`.`cost_center` in %(cost_centers)s
			and `tabGL Entry`.`posting_date` between %(from_date)s and %(to_date)s
			and `tabAccount`.`root_type` = 'Income'
		order by
			`tabGL Entry`.`posting_date` desc,
			`tabGL Entry`.`creation` desc,
			`tabGL Entry`.`name` desc
		limit %(limit)s offset %(limit_start)s
		""",
		{
			"supporter": supporter,
			"cost_centers": tuple(cost_centers),
			"from_date": from_date,
			"to_date": to_date,
			"limit": limit,
			"limit_start": limit_start,
		},
		as_dict=True,
	)
	for row in rows:
		row["amount"] = flt(row.amount)
	return rows


@frappe.whitelist()
def create_contact_change_request(
	supporter: str,
	cost_center: str,
	from_date: str | None = None,
	to_date: str | None = None,
	changes: dict[str, Any] | str | None = None,
) -> dict[str, Any]:
	doc = make_change_request(
		supporter=supporter,
		cost_center=cost_center,
		from_date=from_date,
		to_date=to_date,
		changes=changes or {},
	)
	return {"name": doc.name, "status": doc.status}


@frappe.whitelist()
def get_change_fields() -> list[dict[str, str]]:
	return [{"fieldname": fieldname, "label": label} for fieldname, label in ALLOWED_CHANGE_FIELDS.items()]
