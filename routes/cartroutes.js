const express = require("express");
const router = express.Router();
const {
    getCartfn,
    addToCartfn,
    updateCartItemfn,
    removeCartItemfn
} = require("../controllers/cartcontrollers")

router.get("/users/:userId/cart", getCartfn)
router.post("/users/:userId/cart", addToCartfn)
router.patch("/users/:userId/cart/:productId", updateCartItemfn)
router.delete("/users/:userId/cart/:productId", removeCartItemfn)

module.exports = router;
