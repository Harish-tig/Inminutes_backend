const express = require("express");
const router = express.Router();
const { placeOrderfn, getOrdersfn, getHostedGroupOrdersfn } = require("../controllers/ordercontrollers")

router.post("/users/:userId/orders", placeOrderfn)
router.get("/users/:userId/orders", getOrdersfn)
router.get("/users/:userId/group-orders", getHostedGroupOrdersfn)

module.exports = router;
