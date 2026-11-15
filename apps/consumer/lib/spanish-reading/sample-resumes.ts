/**
 * Made-up English resumes for the Spanish reading's tests and for the cost
 * measurement script (tooling/language-kit/measure-spanish-reading.sh). Every
 * name, employer, school, phone number and email below is invented. They have
 * the shape formatResumeDownload writes, so the measurement sees what the
 * route sees. No real person's data belongs in this file.
 */

export interface SampleResume {
  id: string;
  text: string;
}

const sample = (id: string, text: string): SampleResume => ({ id, text: text.trim() });

export const SAMPLE_RESUMES: SampleResume[] = [
  sample("warehouse", `
DANA WHITFIELD
(555) 010-0142 | dana.whitfield@example.com | Springfield, OH

PROFESSIONAL SUMMARY
Reliable warehouse associate with 6 years of shipping and receiving experience. Certified forklift operator. Known for accurate counts and showing up on time.

PROFESSIONAL EXPERIENCE

Warehouse Associate | Lakeshore Pallet Works, March 2019 - Present
- Load and unload 40 to 60 trucks a week
- Keep inventory counts at 99.5% accuracy across 1,200 pallet locations
- Trained 8 new hires on safe lifting and scanner use

Shipping Clerk | Harbor Street Distribution, June 2016 - February 2019
- Prepared 150 outbound orders per shift
- Reduced mislabeled boxes by 30% in one year

EDUCATION & CERTIFICATIONS
Forklift Operator Certificate | Springfield Career Center  2018
High School Diploma | Maple Grove High School  2012

SKILLS
Forklift Operation | Inventory Control | Pallet Jack | Scanner Guns
`),
  sample("kitchen", `
TOMAS REYES-HALL
(555) 010-0177 | tomas.reyeshall@example.com | Dayton, OH

PROFESSIONAL SUMMARY
Line cook with 9 years in fast-paced kitchens. Strong with prep, food safety and training new cooks.

PROFESSIONAL EXPERIENCE

Line Cook | Harbor Street Diner, April 2018 - Present
- Cook for 120 to 200 guests on weekend shifts
- Passed every health inspection from 2018 to 2024
- Ordered and rotated $4,500 of produce each week

Prep Cook | Bluebird Catering, January 2015 - March 2018
- Prepped meals for events of up to 300 people

EDUCATION & CERTIFICATIONS
ServSafe Food Handler | State Restaurant Association  2019

SKILLS
Food Safety | Knife Skills | Inventory | Team Training
`),
  sample("driver", `
MARCUS OYELARAN-BELL
(555) 010-0163 | m.oyelaranbell@example.com | Toledo, OH

PROFESSIONAL SUMMARY
Commercial driver with a Class B license and 7 years of local delivery routes. Clean driving record for the last 5 years.

PROFESSIONAL EXPERIENCE

Delivery Driver | Northfield Freight Co., May 2017 - October 2024
- Delivered to 35 stops a day across 3 counties
- Logged 210,000 miles with no preventable accidents
- Balanced a $2,300 cash drawer at the end of each route

EDUCATION & CERTIFICATIONS
Class B Commercial Driver License  2017
OSHA 10 Safety Card  2020

SKILLS
Route Planning | Customer Service | Load Securement
`),
  sample("construction", `
ELLIS PARKER
(555) 010-0118 | ellis.parker@example.com | Akron, OH

PROFESSIONAL SUMMARY
Carpenter's helper moving into framing. 4 years on residential job sites. Comfortable with hand tools and power tools.

PROFESSIONAL EXPERIENCE

Carpenter's Helper | Cedar Ridge Builders, July 2020 - Present
- Framed walls and roofs on 12 homes
- Read blueprints and measured to 1/16 of an inch
- Kept the site clean and the tools counted at 5 pm every day

Laborer | Summit Concrete Crew, 2018 - 2020
- Poured and finished about 8,000 square feet of concrete

EDUCATION & CERTIFICATIONS
Pre-Apprenticeship Carpentry Program | Akron Trades Institute  2020

SKILLS
Framing | Blueprint Reading | Power Tools | Site Safety
`),
  sample("cleaning", `
RENATA OKAFOR-LINDQVIST
(555) 010-0191 | renata.okl@example.com | Columbus, OH

PROFESSIONAL SUMMARY
Detail-minded building cleaner with 5 years of experience in offices and medical suites.

PROFESSIONAL EXPERIENCE

Lead Cleaner | Bluebird Cleaning Services, September 2019 - Present
- Lead a team of 4 cleaning 22 office suites each night
- Follow infection control steps in 3 medical offices
- Order supplies within a $900 monthly budget

Janitor | Riverside Community Center, 2017 - 2019
- Opened the building at 6 am for 5 programs each week

EDUCATION & CERTIFICATIONS
Bloodborne Pathogens Training  2021

SKILLS
Infection Control | Floor Care | Team Lead | Supply Ordering
`),
  sample("retail", `
JORDAN ABERNATHY
(555) 010-0155 | jordan.abernathy@example.com | Cincinnati, OH

PROFESSIONAL SUMMARY
Retail associate with 3 years on the sales floor and at the register. Friendly with customers and careful with cash.

PROFESSIONAL EXPERIENCE

Sales Associate | Greenfield Home Goods, February 2022 - Present
- Help about 80 customers a day find what they need
- Handle $3,000 to $5,000 in daily register sales with no shortages
- Restock 15 aisles before the store opens

Cashier | Corner Market on 5th Street, 2021 - 2022
- Worked the front register on 25 hour weeks

EDUCATION & CERTIFICATIONS
High School Equivalency Diploma | Cincinnati Adult Learning Center  2021

SKILLS
Cash Handling | Customer Service | Stocking
`),
  sample("maintenance", `
SAMUEL KOWALCZYK
(555) 010-0132 | samuel.kowalczyk@example.com | Cleveland, OH

PROFESSIONAL SUMMARY
Maintenance technician with 8 years keeping apartment buildings running. Handles plumbing, electrical basics and turnovers.

PROFESSIONAL EXPERIENCE

Maintenance Technician | Parkview Apartments, January 2016 - Present
- Complete about 40 work orders a week in a 220 unit complex
- Turn over 6 apartments a month in 3 days each
- Hold an EPA 608 card and a state boiler tag

Handyman | Self-employed, 2012 - 2015
- Repaired fences, doors and drywall for 30 repeat customers

EDUCATION & CERTIFICATIONS
EPA 608 Certification | Lakeland Trade School  2016

SKILLS
Plumbing | Basic Electrical | Drywall | Preventive Maintenance
`),
  sample("callcenter", `
PRISCILLA NAKAMURA-DOYLE
(555) 010-0108 | priscilla.nd@example.com | Cleveland, OH

PROFESSIONAL SUMMARY
Customer support representative with 4 years answering phones and chat. Calm with upset customers.

PROFESSIONAL EXPERIENCE

Customer Support Representative | Clearwater Insurance Group, August 2020 - Present
- Resolve about 60 calls and chats per shift
- Keep a customer satisfaction score of 4.7 out of 5
- Review 15 claim files a week for missing documents

EDUCATION & CERTIFICATIONS
Associate Degree in Business | Tri-County Community College  2020

SKILLS
Phone Support | Live Chat | Data Entry | Claims Intake
`),
  sample("grounds", `
LEONARD VASQUEZ-ODOM
(555) 010-0184 | leonard.vo@example.com | Youngstown, OH

PROFESSIONAL SUMMARY
Groundskeeper with 10 years of mowing, planting and snow removal for schools and parks.

PROFESSIONAL EXPERIENCE

Groundskeeper | Westmoor School District, March 2014 - Present
- Maintain 14 acres of fields and lawns
- Run a crew of 3 during summer break
- Plow and salt 6 parking lots before 6:30 am

EDUCATION & CERTIFICATIONS
Pesticide Applicator License  2015

SKILLS
Mowing | Planting | Snow Removal | Equipment Repair
`),
  sample("peer", `
ADRIANA FONTENOT
(555) 010-0126 | adriana.fontenot@example.com | Columbus, OH

PROFESSIONAL SUMMARY
Peer support specialist with 3 years helping people find housing and work. Good listener and dependable.

PROFESSIONAL EXPERIENCE

Peer Support Specialist | Open Door Outreach, October 2021 - Present
- Meet with 25 people a month about housing and job leads
- Help 10 to 12 people a quarter fill out applications
- Keep case notes in the agency system within 24 hours

Volunteer Mentor | Second Saturday Workshop, 2019 - 2021
- Ran a monthly resume class for 15 to 20 people

EDUCATION & CERTIFICATIONS
Peer Specialist Certificate | State Department of Health  2021

SKILLS
Active Listening | Case Notes | Housing Resources | Mentoring
`),
];
