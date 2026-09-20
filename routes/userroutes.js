const express = require("express");
const router = express.Router();
const { createUserFn, getUserfn, getUserByIdFn } = require("../controllers/usercontrollers")


router.post("/users", createUserFn)
router.get("/users", getUserfn)
router.get("/users/:userId", getUserByIdFn)

module.exports = router;
