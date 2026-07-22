import 'dotenv/config'
import postgres from 'postgres'

const RAW_DATA = `
Balinder Kumar	9018442329	accessories@jammuautomart.com
Amit Taak	9419130445	accounts@jammuautomart.com
Attan Sharma	8899009155	bodyshopkathua@jammuautomart.com
Vikram  Jamwal	9086066971	crm@jammuautomart.com
K.L Kichloo	9419100680	kichlooam@gmail.com
SHUBHAM PANSOTRA 	7051522325	amvijaypur@jammuautomart.com
LALIT KHAJURIA	9622275404	amvijaypur@jammuautomart.com
MANPREET  KOUR	7051522315	amrspura@jammuautomart.com
Gourav Chun 	9086066606	amrspura@jammuautomart.com
PANKAJ SHARMA	7051522304	amakhnoor@jammuautomart.com
VINAYSHARMA	9796970011	amakhnoor@jammuautomart.com
MALIK SHARMA	8899009119	ambillawar@jammuautomart.com
RAJAN MASKI	8899009122	ambillawar@jammuautomart.com
LakhbirSingh	9541941298	headit@jammuautomart.com
Sachin Kapoor	7051534538	bodyshop@jammuautomart.com
Irfan Dar	7051522307	ampreownedcars@jammuautomart.com
ParvinderSingh	9906906360	parvindersingh@jammuautomart.com
Riteshwar Singh	9697693904	hr@jammuautomart.com
Loveleen Singh	7051522300	hr@amgroupind.com
Ajay Kumar	7006610470	Insurance@jammuautomart.com
Parveen Rajan	9086061672	rsomanager@jammuautomart.com
Adil Umar	9797379999	Sales@jammuautomart.com
Ashwani Pardhan	9086061651	gmsales@jammuautomart.com
Ranjana Devi	9484200000	crmsales@jammuautomart.com
VP Sales Jammu Automart	7051892251	saleshead@jammuautomart.com
Manoj Chowdhary	9086061648	service@jammuautomart.com
Aman Gupta	9797434444	vpservice@jammuautomart.com
AMMobis	8899005579	ammobis@jammuautomart.com
Satyendra KumarMaurya	7051522316	parts@jammuautomart.com
Neeraj Pandita	7006415682	ihtservice@jammuautomart.com
Jug Raj	9086061631	Kathua@jammuautomart.com
MANOJ GUPTA	9086061675	kathua@jammuautomart.com
RUKHVINDER	7006172180	tech@amgroupind.com
Sanjeev Talwar	9419285772	accounts@amhyundai.com
AKASH SHARMA	6006468915	ampoonch@amhyundai.com
Arvind Gupta	9419261616	arvind.gupta@amhyundai.com
Parveen Kumar	8899009080	bodyshop@amhyundai.com
Intsam Ahmed	7051522340	bodyshoprajouri@amhyundai.com
Munish Salgotra	9484077777	crm@amhyundai.com
Anchal Shangloo	9484277777	crmplatinum@amhyundai.com
Inzamam	9419031414	crmrajouri@amhyundai.com
Poonam Koul	7006289937	marketing@amgroupind.com
Amit Khanna	9419147494	financeofficer@amhyundai.com
Deepak Nagri	9086263568	headit@amhyundai.com
Aditya Sambyal	9419186167	hpromise@amhyundai.com
Ajay Sharma	9484042073	hr@amhyundai.com
Sunny Chib	9419844356	insurance@amhyundai.com
Ranjeet Singh	9541899582	partrajouri@amhyundai.com
Bisham Kumar	9484042056	parts@amhyundai.com
NILNIL	8803740000	rajouri@amhyundai.com
RAJUBHAU	9682578559	rtodocuments@amhyundai.com
CharanpreetSingh	9086061635	sales@amhyundai.com
Rajiv Bali	9484177777	service@amhyundai.com
HardeepSingh	7051522340	servicerajouri@amhyundai.com
Parteek Kumar	8082002316	warranty@amhyundai.com
YasinShah	9541899588	warrantyrajouri@amhyundai.com
Amandeep Singh	7051522327	workshop@amhyundai.com
BALBIR SINGH	9484041979	 bodyshop@amtata.net
GURJOT SINGH	9541941297	<headit@amtata.net
Rohini Gupta	9419117416	accessories@amtata.net
RAJESH SHARMA	9419308797	accounts@amtata.net
AMAN SHARMA	8899002412	amsapwal@amtata.net
Arun Kumar	9484041979	bodyshop@amtata.net
SHAMMI SETH	9484042004	crm@amtata.net
NAVITA MATTOO	9541942614	cxm@amtata.net
POOJA RANA	9484042001	hr@amtata.net
HIMANSHU  SALGOTRA	9484042003	insurance@amtata.net
AM Tata		irakycindia_amtata@amtata.net
RAJAN PAL	9541941296	kathua@amtata.net
RAM JI	8899002411	parts@amtata.net
RAMAN MEET SINGH	9596075038	poonch@amtata.net
AMIT KHAJURIA	8899002420	salesmanagerjmu@amtata.net
ANIL GUPTA	9484288888	service@amtata.net
TarunTATA	9469712345	tarun@amtata.net
Aman Bains	9888100065	vp@amtata.net
RAHUL MANHAS	8899002413	warranty@amtata.net
Sonia	8899883121	hr@diamondjammu.com
Dheeraj  Khajuria	9484166666	sales@diamondjammu.com
KUSH DEVSambyal	9858502659	service@diamondjammu.com
Balbir Singh DH	9858508654	balbirsinghhonda@gmail.com
ArjunSharma	8082828293	crmhonda08@gmail.com
Jugleen kour	9541902744	JAMMU.RECEPTIONIST2@mgdealer.co.in
Rahul salgotra	9541902741	JAMMU.IT2@mgdealer.co.in
Yograj singh	9541902731	JAMMU.EDP2@mgdealer.co.in
Avinash Kapoor	9541902733	JAMMU.SC21@mgdealer.co.in
Sunit singh	9419183277	JAMMU.GM@MGDEALER.CO.IN
Harpreet  kour	9797290777	JAMMU.CRM@mgdealer.co.in
Harpreet  singh	9541902730	JAMMU.WARRANTY@mgdealer.co.in
Vishal kumar	9541902737	JAMMU.BODYSHOP@mgdealer.co.in
Nisha devi	9541902742	JAMMU.CRE11@MGDEALER.CO.IN
Goldee younus	9541902745	JAMMU.PDI@mgdealer.co.in
Peehu	9541902740	JAMMU.HR11@mgdealer.co.in
Amit verma	9541902732	JAMMU.ACCOUNTS2@mgdealer.co.in
Shafqat ali	9541902739	JAMMU.EVTEXPERT@mgdealer.co.in
Dilbagh singh	9541902738	JAMMU.TEXPERT@mgdealer.co.in
Riya pandita	9541902746	JAMMU.CRE13@mgdealer.co.in
Davinder singh	9541911031	JAMMU.SA11@MGDEALER.CO.IN
Varun Mehra	9541902743	JAMMU.SA12@MGDEALER.CO.IN
Manav Singh	9541910468	
Pankaj  Jasrotia	9541910470	jammu.tl1@mgdealer.co.in
SARTAJ SINGH	9541902747	jammu.saleshead2@mgdealer.co.in
Himat Thapa	9797390777	jammu.servicehead1@mgdealer.co.in
Alexender Salhotra	9541902719	jammu.saleshead2@mgdealer.co.in
Gaurav Singh	9541908718	athravautocrave@gmail.com
Shubam Singh	9541910469	jammu.sc26@mgdealer.co.in
Sumit Mehra	8899247487	parts@ambajaj.com
Raman Sahdev	9541712121	raman.sahdev@amgroupind.com
Mitul Gandotra	7006083653	sales@ambajaj.com
Yug Raj	9797937700	triumphjammu9@gmail.com
Neeraj Shakaya	9797319690	service@ambajaj.com
Naresh Kumar	9086085852	nareshamghomes@gmail.com
Anirudh Abrol	9622017928	ktmjammu@gmail.com
Jagmeet Singh	9858240877	accessories@amkia.in
Keshav Jamwal	9796438819	accounts@amkia.in
CPO AM Kia	-	cpo@amkia.in
Directors AM Kia		
Ramanpreet Singh	9419111128	gmsales@amkia.in
Bhawana Kumari	9484042067	hr@amkia.in
Sonal Gondi	9484320870	insurance@amkia.in
Sanjeev Koul	9419111126	sales@amkia.in
Ankush  Chalotra	9541941374	service@amkia.in
AM Kia Sales	8082751111	udhampur.sales@amkia.in
AM Kia Service	9419234444	
Deepika Sharma	9484320915	deepikajammuautomart@gmail.com
Vikas Gupta	9419203886	cavikasgupta1981@gmail.com
 Rakesh Koul	7889500416	koul.009@gmail.com
Nikhil Luthra	9086201288	luthranikhil@yahoo.com
ANIRUDH DEV SHARMA	8082378900	studiosevensages@gmail.com
HARITISH SETHI	7889355621	sales@amhyundai.com
Sanjay Mahajan	9906098888	sanjay@jammuautomart.com
Vanya Bagga	7051522347	eajammuautomart@gmail.com
SANJEEV MAHAJAN	9419185482	sanjeevmahajan22@gmail.com
Vikesh Sharma	7051892051	recoveryamgroup@gmail.com
Chander Sheikhar	9419188590	chander.sheikhar27@gmail.com
SWATANTER SINGH	7006285603	swatanter0017@gmail.com
JASMEET SINGH	9596077477	meet06825@gmail.com
DEEPAK KUMAR	8082234217	jmsthapa8@gmail.com
PUSHPANKAR	9906121765	pushpankar.chambyal@yahoo.com
ASHA DEVI	9149982872	ashabhagat774@gmail.com
RAHIDA SALEEM	9541905415	rahidukhan264@gmail.com
VISHALI SHARMA	9149982323	vishalishrma4@gmail.com
SUMIT BHAU	9086103919	sumitbhau33@gmail.com
NIRMAL LAKHOTRA	7889515057	lakhotraabi@gmail.com
MUMTAZ WANI	7051522310	mumtaz786wani@gmail.com
SAMBAV KOUSHAL	7006642486	koushalsambav@gmail.com
AKARSHIT GUPTA	9796033375	akarshitgupta375@yahoo.in
ISHAN  PAL SINGH	9858563123	ishansinghhh33@gmail.com
MUSADIQ	7889393663	musadik.khan73@gmail.com
VISHAL KUMAR	9796240159	vishalviky91@gmail.com
POOJA KOUL	7006926018	poojakoul010@gmail.com
SAMBI SHARMA	8493850352	saambi1992@gmail.com
ASHFAQ AHMED	6006410552	asm954268@gmail.com
SHEETAL SONI	9858203800	sheetal.soni1111@gmail.com
KARAN KUMAR	7051365430	kumarkaran63378@gmail.com
AMAN MAHAJAN	7006433050	amanmahajan9797@gmail.com
HIMANSHU SLATHIA	6005929417	Himanshuslathia66@gmail.com
NISSAR Ahmed	7889617326	nissarkhawaja91@gmail.com
ABINASH	6005323962	abinashverma615@gmail.com
MOHIT LOACH	9419123081	mohitmiks786@gamil.com
SHIVANI VERMA	9797992840	shivaniverma8042@gmail.com
NOWREENA AKHTER	9149820163	nowreenshah20@gmail.com
ROSHNI Nagalia	6005055993	roshninagalia770@gmail.com
SARTAJ SINGH	7006850580	sartaj.saru123@gmail.com
Vijay Singh	8825063763	Vijaysingh26082000@gmail.com
ASHWANI PRADHAN	9086061651	Gmsales@jammuautomart.com
SANJEET SINGH	99067101779	sanjeetsingh481@gmail.com
ASHISH THAPA	9990535881	thapa336@gmail.com
ASHISH BIMAL	8082087707	ashish.sb7707@gmail.com
Balwinder Singh	6005213046	Khalsa1419@gmail.com
Mohd Taufiq	7780869040	Azrehan624@gmail.com
Mukesh	9596715835	mukeshvermajk02@gmail.com
Ram Gopal	9596977070	
Birbal	9906139279	birbalatri@gmail.com
ERSHAD	9469544441	udhampur.sales@amkia.in
Parshotam	9858503604	vermaparshotam@gmail.com
Govil Sawhney	6006769844	ampreownedcars@jammuautomart.com
Nowreena	9149820163	nowreenshah20@gmail.com
Musadiq	7889393663	musadik.khan73@gmail.com
Shivani	9149820163	Shivaniverma8042@gmail.com
Vishal	9796240159	vishalviky91@gmail.com
Ashish Bimal	8082087707	ashish.sb7707@gmail.com
Balwinder Singh	6005213046	Khalsa1419@gmail.com
Akarshit	9796033375	akarshitgupta375@yahoo.in
Pushpankar	9906121765	pushpankar.chambyal@yahoo.com
Lalit	9469947577	lalitkoushal@yahoo.com
Abinash verma	6005323962	abinashverma615@gmail.com
Mukesh	9596715835	mukeshvermajk02@gmail.com
Ashish Thapa	9990535881	thapa336@gmail.com
Toufeeq	7780869040	Azrehan624@gmail.com
Jasmeet	9596077477	meet06825@gmail.com
Vijay	8825063763	Vijaysingh26082000@gmail.com
Harsh	9103639480	Harshsodhi57@gmail.com
Sambhav	7006642486	koushalsambav@gmail.com
Roshni	6005055993	roshninagalia770@gmail.com
Himanshu	6005929417	Himanshuslathia66@gmail.com
Munish	9149982321	mkumar97365@gmail.com
Bhandari	9086061632	lbbhandari70@gmail.com
Amit Khanna	9419147494	financeofficer@amhyundai.com
Karnesh Uttam	94843 20905	crm@amkia.in
Rajeshwar Bandral	9484320875	idtsales@amkia.in
Arun Trivedi MIS	639275284	tech@amgroupind.com
Vikrant	94843 20890	bodyshop@amkia.in
Karan 	9086261269	edp@amkia.in
Simran 	9906791684	insurance@amkia.in
Naresh	90860 85852	jammu.accounts2@mgdealer.co.in
Ajay 	90860 61646	insurance@jammuautomart.com
Anirudh	9622017928	ktmjammu@gmail.com
Ankush	9541904830	kashmirautoaidspvtltd230313@gmail.com
MK Pandita	941919183689	financeofficer@amhyundai.com
Sunil Verma	9419109735	vermasunil195813@gmail.com
Ravi	8899629121	network@diamondjammu.com
Siddhart	9541923558	warranty.claims@amgroupind.com
Aman	9858502651	edpamandiamond@gmail.com
Dheeraj  KUMAR       	9596631827	dheeraj29492949@gmail.com
Sanjeev Kashyap	8725024685	 ampoonch@amhyundai.com
Saijal	9484320421	ea@amkia.in
Dewanshi	9484042048	pcrollpe@gmail.com
`

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  const lines = RAW_DATA.split('\n')
  let importedCount = 0
  let usersUpdated = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // Split by tabs or multiple spaces
    const parts = line.split(/\t+/).map((p) => p.trim()).filter(Boolean)

    let name = ''
    let phone = ''
    let email = ''

    if (parts.length === 3) {
      name = parts[0]
      phone = parts[1]
      email = parts[2]
    } else if (parts.length === 2) {
      name = parts[0]
      // check if second part looks like phone or email
      if (parts[1].includes('@')) {
        email = parts[1]
      } else {
        phone = parts[1]
      }
    } else if (parts.length === 1) {
      name = parts[0]
    }

    // Clean up name
    name = name.replace(/^["'<]+|["'>]+$/g, '').trim()
    if (!name || name === '-' || name.toLowerCase().includes('directors am kia')) continue

    // Clean up email
    email = email.replace(/^["'<]+|["'>]+$/g, '').trim().toLowerCase()
    if (email === '-' || email === 'nilnil') email = ''

    // Clean up phone
    phone = phone.replace(/[^0-9+]/g, '').trim()
    if (phone === '-' || phone.length < 5) phone = ''

    if (!name) continue

    // 1. If email matches a user in users table, update phone_number in users table if missing!
    if (email) {
      const existingUser = await sql`SELECT id, phone_number FROM users WHERE LOWER(email) = ${email} LIMIT 1`
      if (existingUser.length > 0) {
        if (phone && !existingUser[0].phone_number) {
          await sql`UPDATE users SET phone_number = ${phone} WHERE id = ${existingUser[0].id}`
          usersUpdated++
        }
      }
    }

    // 2. Check if contact already exists in delegation_contacts (by phone or name)
    let existingContact = []
    if (phone) {
      existingContact = await sql`SELECT id FROM delegation_contacts WHERE phone = ${phone} LIMIT 1`
    }
    if (existingContact.length === 0 && name) {
      existingContact = await sql`SELECT id FROM delegation_contacts WHERE LOWER(name) = ${name.toLowerCase()} LIMIT 1`
    }

    if (existingContact.length > 0) {
      await sql`
        UPDATE delegation_contacts
        SET name = ${name}, email = ${email || null}, phone = ${phone || 'N/A'}
        WHERE id = ${existingContact[0].id}
      `
    } else {
      await sql`
        INSERT INTO delegation_contacts (name, email, phone)
        VALUES (${name}, ${email || null}, ${phone || 'N/A'})
      `
      importedCount++
    }
  }

  console.log(`Seeding finished! Created/Updated contacts: ${importedCount}, Updated users phone numbers: ${usersUpdated}`)
  await sql.end()
}

main().catch(console.error)
