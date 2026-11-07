-- Real directory configuration only. No students, staff grants, listings or stock.
-- User selected WWU residential mail pickup desks for this student project.
-- Sources checked 2026-11-07:
-- https://housing.wwu.edu/life-on-campus/mail-deliveries
-- https://housing.wwu.edu/files/documents/Front%20Desk%20Locations.pdf
INSERT INTO public."Campus" (id,slug,name,"emailDomains","isDemo")
VALUES ('27779c43-6b17-4e2f-8d8b-a9a8ab326001','wwu','Western Washington University',ARRAY['wwu.edu'],false)
ON CONFLICT (slug) DO NOTHING;
INSERT INTO public."Category" (id,name) VALUES
('food','Food'),('clothing','Clothing'),('shoes','Shoes'),('transportation','Transportation / Carpooling'),('supplies','School Supplies'),('household','Household Essentials'),('housing','Housing Resources'),('healthcare','Healthcare'),('other','Other')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public."Location" (id,"campusId",name,building,hours,instructions,active)
SELECT x.id::uuid,c.id,x.name,x.building,
'Check current front desk hours with WWU Housing; arrange an exchange time with assigned project staff.',
'Independent student exchange. This desk is a user-selected meeting location, not a WWU-approved donation service. Arrange drop-off with assigned project staff first. Do not leave unattended items or use parcel lockers. Wait for staff receipt confirmation and a reservation before pickup.',true
FROM (VALUES
('27779c43-6b17-4e2f-8d8b-a9a8ab326011','Edens / Higginson','Edens Hall First Floor Entrance'),
('27779c43-6b17-4e2f-8d8b-a9a8ab326012','Ridgeway','Ridgeway Commons'),
('27779c43-6b17-4e2f-8d8b-a9a8ab326013','Nash','Nash 153'),
('27779c43-6b17-4e2f-8d8b-a9a8ab326014','Mathes','Mathes 287'),
('27779c43-6b17-4e2f-8d8b-a9a8ab326015','Fairhaven','Fairhaven Commons 123'),
('27779c43-6b17-4e2f-8d8b-a9a8ab326016','Birnam Wood','Birnam Wood Community Building'),
('27779c43-6b17-4e2f-8d8b-a9a8ab326017','Buchanan Towers','Buchanan Towers Classic 116')
) AS x(id,name,building)
JOIN public."Campus" c ON c.slug='wwu'
ON CONFLICT (id) DO NOTHING;
