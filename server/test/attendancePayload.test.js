const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildAttendanceLookup,
  buildAttendancePayload
} = require("../src/services/attendancePayload");

const fixedNow = new Date("2026-05-24T09:30:00.000Z");

test("builds a Faculty Mongo payload with volunteer-selected Session", () => {
  const qrText = JSON.stringify({
    type: "Faculty",
    name: "Alice Singh",
    phone: "9011908534",
    email: "alicesingh@gmail.com"
  });

  const descriptor = buildAttendancePayload(qrText, "morning", { username: "volunteer-a" }, fixedNow);

  assert.equal(descriptor.personType, "Faculty");
  assert.equal(descriptor.storageGroup, "faculty");
  assert.deepEqual(
    {
      type: descriptor.payload.type,
      name: descriptor.payload.name,
      phone: descriptor.payload.phone,
      email: descriptor.payload.email,
      Session: descriptor.payload.Session
    },
    {
      type: "Faculty",
      name: "Alice Singh",
      phone: "9011908534",
      email: "alicesingh@gmail.com",
      Session: "Morning"
    }
  );
  assert.equal("id" in descriptor.payload, false);

  const lookup = buildAttendanceLookup(descriptor);
  assert.equal(lookup.Session, "Morning");
  assert.equal(lookup.dateKey, "2026-05-24");
});

test("builds a Student Mongo payload with id and selected Session", () => {
  const qrText = JSON.stringify({
    type: "Student",
    id: "Nil",
    name: "Aravind",
    phone: "9876553210",
    email: "aravindbn2006@gmail.com"
  });

  const descriptor = buildAttendancePayload(qrText, "afternoon", { username: "volunteer-b" }, fixedNow);

  assert.equal(descriptor.personType, "Student");
  assert.equal(descriptor.storageGroup, "student");
  assert.deepEqual(
    {
      type: descriptor.payload.type,
      id: descriptor.payload.id,
      name: descriptor.payload.name,
      phone: descriptor.payload.phone,
      email: descriptor.payload.email,
      Session: descriptor.payload.Session
    },
    {
      type: "Student",
      id: "Nil",
      name: "Aravind",
      phone: "9876553210",
      email: "aravindbn2006@gmail.com",
      Session: "Afternoon"
    }
  );
});

test("builds a Professional Mongo payload with company and designation", () => {
  const qrText = JSON.stringify({
    type: "Professional",
    name: "Rahul Shetty",
    email: "rahulshetty@gmail.com",
    company: "Intel",
    designation: "Software Engineer",
    phone: "9007314831"
  });

  const descriptor = buildAttendancePayload(qrText, "evening", { username: "volunteer-c" }, fixedNow);

  assert.equal(descriptor.personType, "Professional");
  assert.equal(descriptor.storageGroup, "professional");
  assert.deepEqual(
    {
      type: descriptor.payload.type,
      name: descriptor.payload.name,
      email: descriptor.payload.email,
      company: descriptor.payload.company,
      designation: descriptor.payload.designation,
      phone: descriptor.payload.phone,
      Session: descriptor.payload.Session
    },
    {
      type: "Professional",
      name: "Rahul Shetty",
      email: "rahulshetty@gmail.com",
      company: "Intel",
      designation: "Software Engineer",
      phone: "9007314831",
      Session: "Evening"
    }
  );
});
