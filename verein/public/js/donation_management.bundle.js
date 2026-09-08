/* global verein */
import { CostCenterOverviewPage } from "./donation_management/cost_center_overview.js";
import { CostCenterBookingsPage } from "./donation_management/cost_center_bookings.js";
import { DonorsPage } from "./donation_management/donors.js";
import { create_page_runtime } from "./donation_management/runtime.js";

frappe.provide("verein.donation_management");
verein.donation_management.refresh_page = create_page_runtime({
	"cost-center-overview": { Page: CostCenterOverviewPage, property: "costCenterOverview" },
	"cost-center-bookings": { Page: CostCenterBookingsPage, property: "costCenterBookings" },
	donors: { Page: DonorsPage, property: "donorsPage" },
});
