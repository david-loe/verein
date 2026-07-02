from __future__ import annotations

import frappe


def ensure_role(role_name: str):
	if not frappe.db.exists("Role", role_name):
		frappe.get_doc({"doctype": "Role", "role_name": role_name, "desk_access": 1}).insert(
			ignore_permissions=True
		)


def make_user(email: str, roles: list[str] | None = None) -> str:
	roles = roles or []
	for role in roles:
		ensure_role(role)

	if not frappe.db.exists("User", email):
		previous_in_import = frappe.flags.in_import
		frappe.flags.in_import = True
		try:
			frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": email.split("@", 1)[0],
					"enabled": 1,
					"send_welcome_email": 0,
				}
			).insert(ignore_permissions=True)
		finally:
			frappe.flags.in_import = previous_in_import

	user = frappe.get_doc("User", email)
	for role in roles:
		if role not in [row.role for row in user.roles]:
			user.append("roles", {"role": role})
	user.save(ignore_permissions=True)
	return email


def get_company() -> str:
	company = frappe.db.get_value("Company", "_Test Company", "name")
	if company:
		return company

	company = frappe.db.get_value("Company", {}, "name")
	if not company:
		frappe.throw("No Company is available for Donation Management tests.")
	return company


def get_root_cost_center(company: str) -> str:
	root = frappe.db.get_value(
		"Cost Center",
		{"company": company, "is_group": 1, "parent_cost_center": ["is", "not set"]},
		"name",
	)
	if root:
		return root

	root = frappe.db.get_value("Cost Center", {"company": company, "is_group": 1}, "name")
	if not root:
		frappe.throw(f"No root Cost Center is available for {company}.")
	return root


def make_cost_center(parent_cost_center: str | None = None, is_group: int = 0, company: str | None = None) -> str:
	company = company or get_company()
	parent_cost_center = parent_cost_center or get_root_cost_center(company)
	doc = frappe.get_doc(
		{
			"doctype": "Cost Center",
			"cost_center_name": f"DM Test Cost Center {frappe.generate_hash(length=8)}",
			"parent_cost_center": parent_cost_center,
			"company": company,
			"is_group": is_group,
		}
	).insert(ignore_permissions=True)
	return doc.name


def get_account(company: str, root_type: str) -> str:
	account = frappe.db.get_value(
		"Account",
		{"company": company, "root_type": root_type, "is_group": 0, "disabled": 0},
		"name",
	)
	if account:
		return account

	parent_account = frappe.db.get_value(
		"Account",
		{"company": company, "root_type": root_type, "is_group": 1, "disabled": 0},
		"name",
	)
	if not parent_account:
		frappe.throw(f"No {root_type} account is available for {company}.")

	doc = frappe.get_doc(
		{
			"doctype": "Account",
			"account_name": f"DM Test {root_type} {frappe.generate_hash(length=6)}",
			"company": company,
			"parent_account": parent_account,
			"root_type": root_type,
			"report_type": "Profit and Loss",
			"is_group": 0,
		}
	).insert(ignore_permissions=True)
	return doc.name


def make_access(user: str, cost_center: str, access_level: str = "View", active: int = 1):
	return frappe.get_doc(
		{
			"doctype": "Cost Center Access",
			"user": user,
			"cost_center": cost_center,
			"access_level": access_level,
			"active": active,
		}
	).insert(ignore_permissions=True)


def make_budget(cost_center: str, from_date: str, budget_amount: float):
	return frappe.get_doc(
		{
			"doctype": "Cost Center Budget",
			"cost_center": cost_center,
			"from_date": from_date,
			"budget_amount": budget_amount,
		}
	).insert(ignore_permissions=True)


def make_gl_entry(
	cost_center: str,
	account: str,
	posting_date: str,
	debit: float = 0,
	credit: float = 0,
	is_cancelled: int = 0,
	remarks: str | None = None,
):
	company = frappe.db.get_value("Cost Center", cost_center, "company")
	account_currency = frappe.db.get_value("Account", account, "account_currency")
	doc = frappe.get_doc(
		{
			"doctype": "GL Entry",
			"posting_date": posting_date,
			"account": account,
			"cost_center": cost_center,
			"company": company,
			"voucher_type": "Journal Entry",
			"voucher_no": f"DM-TEST-{frappe.generate_hash(length=10)}",
			"debit": debit,
			"credit": credit,
			"debit_in_account_currency": debit,
			"credit_in_account_currency": credit,
			"account_currency": account_currency,
			"is_cancelled": is_cancelled,
			"remarks": remarks,
		}
	)
	doc.flags.from_repost = True
	return doc.insert(ignore_permissions=True, ignore_links=True)
