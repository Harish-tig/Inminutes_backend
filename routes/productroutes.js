const express = require("express");
const router = express.Router();
const { getProductsfn, getProductByIdfn } = require("../controllers/productcontrollers")

router.get("/products", getProductsfn);
router.get("/products/:productId", getProductByIdfn);

module.exports = router;
