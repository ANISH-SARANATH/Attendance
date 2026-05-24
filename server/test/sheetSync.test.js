const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSheetRecord,
  buildSheetRow,
  findMatchingRowIndex,
  getSheetLayout
} = require("../src/services/sheetSync");

test("formats the student sheet row as USN/id, Name, Phone, Email, Morning, Afternoon, Evening", () => {
  const record = buildSheetRecord({
    type: "Student",
    id: "Nil",
    name: "Aravind",
    phone: "9876553210",
    email: "aravindbn2006@gmail.com",
    Session: "Afternoon"
  });

  assert.deepEqual(getSheetLayout("Student").headers, [
    "USN/id",
    "Name",
    "Phone",
    "Email",
    "Morning",
    "Afternoon",
    "Evening"
  ]);
  assert.deepEqual(buildSheetRow("Student", [], record), [
    "Nil",
    "Aravind",
    "9876553210",
    "aravindbn2006@gmail.com",
    "",
    "Y",
    ""
  ]);
});

test("updates the faculty sheet row without losing existing session flags", () => {
  const record = buildSheetRecord({
    type: "Faculty",
    name: "Alice Singh",
    phone: "9011908534",
    email: "alicesingh@gmail.com",
    Session: "Evening"
  });

  const existingRow = ["Alice Singh", "9011908534", "alicesingh@gmail.com", "Y", "", ""];

  assert.deepEqual(buildSheetRow("Faculty", existingRow, record), [
    "Alice Singh",
    "9011908534",
    "alicesingh@gmail.com",
    "Y",
    "",
    "Y"
  ]);
});

test("formats and matches the professional sheet row by email/phone", () => {
  const record = buildSheetRecord({
    type: "Professional",
    name: "Rahul Shetty",
    email: "rahulshetty@gmail.com",
    company: "Intel",
    designation: "Software Engineer",
    phone: "9007314831",
    Session: "Morning"
  });

  const existingRows = [
    ["Rahul Shetty", "rahulshetty@gmail.com", "Intel", "Software Engineer", "9007314831", "", "", ""]
  ];

  assert.deepEqual(getSheetLayout("Professional").headers, [
    "Name",
    "email",
    "company",
    "designation",
    "phoneno",
    "Morning",
    "Afternoon",
    "Evening"
  ]);
  assert.equal(findMatchingRowIndex("Professional", existingRows, record), 0);
  assert.deepEqual(buildSheetRow("Professional", existingRows[0], record), [
    "Rahul Shetty",
    "rahulshetty@gmail.com",
    "Intel",
    "Software Engineer",
    "9007314831",
    "Y",
    "",
    ""
  ]);
});
